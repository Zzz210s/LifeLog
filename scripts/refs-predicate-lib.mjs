/**
 * 筛选 / 关键词谓词的只读复刻(照 `src-tauri/src/db/repos/filter_predicates.rs` +
 * `notes_filter_groups_compile.rs` 逐字,含 HEAD `e7057d81` 起的 `note_only` 收窄)。
 *
 * 关键口径(2026-10-10 定):
 *  - 标签 / 排除标签 / 关系 / 排除关系一律收窄到「树外实体(笔记)」行(`n.path IS NULL`),
 *    与产品 `note_only(...)` 一致 —— 不收窄时 tag→tag 边的**源标签自己**会进命中集
 *    (预演实测 `地点轴/所在` +10、`状态/已完成` +7)。
 *  - 关键词 >=3 字走 `entities_fts MATCH '"k"*'`,否则退化为正文 / 被引用实体子串 LIKE。
 *  - `presence`(any/none)与 `treeMembership`、`singleLine` 不收窄(产品同样如此)。
 *  - 用户输入只进 `?` 参数,永不进 SQL 文本。
 */
export function buildPredicates(db) {
  const all = (sql, ...a) => db.prepare(sql).all(...a);

  const CARRY = `t.id IN (SELECT d.id FROM entities d
    JOIN edges cl ON cl.kind = 'link' JOIN entities ca ON ca.id = cl.source_id
    WHERE cl.target_id IN (SELECT id FROM entities WHERE path = ?)
      AND ca.path IS NOT NULL
      AND (d.path = ca.path OR substr(d.path, 1, length(ca.path) + 1) = ca.path || '/'))`;
  const carry = (path, args) => (args.push(path), CARRY);
  const tagPredicate = (path, selfOnly, args) => {
    const direct = selfOnly
      ? (args.push(path), 't.path = ?')
      : (args.push(path, path, path), "t.path = ? OR substr(t.path, 1, length(?) + 1) = ? || '/'");
    return `(${direct}) OR ${carry(path, args)}`;
  };
  const tagExists = (m) => `EXISTS (SELECT 1 FROM edges l JOIN entities t ON t.id = l.target_id
    WHERE l.kind = 'link' AND l.source_id = n.id AND (${m}))`;
  const noteOnly = (p) => `(n.path IS NULL AND (${p}))`;
  const anyTag = () => "EXISTS (SELECT 1 FROM edges l WHERE l.kind = 'link' AND l.source_id = n.id)";
  const kwPred = (k, args) => {
    if ([...k].length >= 3) {
      args.push(`"${k.replaceAll('"', '""')}"*`);
      return 'n.id IN (SELECT rowid FROM entities_fts WHERE entities_fts MATCH ?)';
    }
    args.push(`%${k}%`, `%${k}%`, `%${k}%`);
    return `(n.meta LIKE ? OR EXISTS (SELECT 1 FROM edges l JOIN entities t ON t.id = l.target_id
      WHERE l.kind = 'link' AND l.source_id = n.id AND (t.path LIKE ? OR t.meta LIKE ?)))`;
  };
  // = closure.rs 的 CLOSURE_CTE(渲染闭包 = is_cited=1 ∪ 祖先;不是裸 is_cited)
  const CLOSURE = `n.id IN (WITH RECURSIVE up(id) AS (
    SELECT id FROM entities WHERE is_cited = 1
    UNION SELECT e.source_id FROM edges e JOIN up ON e.target_id = up.id WHERE e.kind = 'child')
    SELECT id FROM up)`;

  function itemPred(it, args) {
    switch (it.kind) {
      case 'keyword': {
        const v = String(it.value ?? '').trim();
        return v ? kwPred(v, args) : null;
      }
      case 'tag':
        return noteOnly(tagExists(tagPredicate(it.path, !it.includeChildren, args)));
      case 'excludeTag':
        return noteOnly(`NOT ${tagExists(tagPredicate(it.path, !it.includeChildren, args))}`);
      case 'relation':
        return noteOnly(tagExists(carry(it.path, args)));
      case 'excludeRelation':
        return noteOnly(`NOT ${tagExists(carry(it.path, args))}`);
      case 'presence':
        if (it.value === 'any') return anyTag();
        if (it.value === 'none') return `NOT (${anyTag()})`;
        return null;
      case 'treeMembership':
        if (it.value === 'in') return CLOSURE;
        if (it.value === 'out') return `NOT (${CLOSURE})`;
        return null;
      case 'singleLine':
        if (it.value === 'single') return 'instr(n.meta, char(10)) = 0';
        if (it.value === 'multi') return 'instr(n.meta, char(10)) > 0';
        return null;
      default:
        throw new Error(`读数器不认识的条件项: ${JSON.stringify(it)}`);
    }
  }
  const opOf = (s) => (String(s ?? '').toLowerCase() === 'or' ? 'or' : 'and');

  /** 旧平铺字段 -> groups[0](照 normalize_groups;只做本预览可能遇到的搬迁) */
  function normalizeGroups(c) {
    if ((c.groups ?? []).length > 0) return c.groups;
    const items = [];
    const kw = String(c.keyword ?? '').trim();
    if (kw) items.push({ kind: 'keyword', value: kw });
    for (const t of c.tags ?? []) items.push({ kind: 'tag', path: t.path, includeChildren: !!t.includeChildren });
    for (const t of c.excludeTags ?? []) items.push({ kind: 'excludeTag', path: t.path, includeChildren: !!t.includeChildren });
    for (const r of c.relations ?? []) items.push({ kind: 'relation', path: r.path });
    for (const r of c.excludeRelations ?? []) items.push({ kind: 'excludeRelation', path: r.path });
    if (c.tagPresence) items.push({ kind: 'presence', value: c.tagPresence });
    if (c.expr) items.push({ kind: 'expr', value: c.expr });
    if (c.treeMembership) items.push({ kind: 'treeMembership', value: c.treeMembership });
    if (c.singleLine) items.push({ kind: 'singleLine', value: c.singleLine });
    return items.length ? [{ op: 'and', items }] : [];
  }
  /** 条件对象 -> SQL 片段(照 where_clause;expr 项本读数器不支持,遇上报错不静默) */
  function whereClause(c) {
    const args = [];
    const frags = [];
    for (const g of normalizeGroups(c)) {
      const parts = [];
      for (const it of g.items ?? []) {
        const p = itemPred(it, args);
        if (p) parts.push(`(${p})`);
      }
      if (parts.length) frags.push(`(${parts.join(opOf(g.op) === 'or' ? ' OR ' : ' AND ')})`);
    }
    if (!frags.length) return { frag: '1=1', args };
    return { frag: `1=1 AND (${frags.join(opOf(c.groupOp) === 'or' ? ' OR ' : ' AND ')})`, args };
  }
  const runWhere = (c) => {
    const { frag, args } = whereClause(c);
    return all(`SELECT n.id AS id FROM entities n WHERE (${frag}) ORDER BY n.id`, ...args).map((r) => r.id);
  };
  const ids = (spec) => {
    const args = [];
    const p = itemPred(spec, args);
    return all(`SELECT n.id AS id FROM entities n WHERE (${p}) ORDER BY n.id`, ...args).map((r) => r.id);
  };
  return { whereClause, runWhere, ids };
}

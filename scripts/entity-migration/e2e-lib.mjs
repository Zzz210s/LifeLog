// T2.5 e2e 辅助(自 e2e.mjs 拆出,守 200 行红线)。纯只读:
//   - 库侧筛选编译:口径对齐 Rust `filter_predicates.rs`,走 db-compat 的只读老名视图
//     (`entities` / `edges` / `entities_fts`),调用方传入标量读数函数 `count(sql)`。
//   - v31 副本读数:直读原生 `points` / `lines`,算递归闭包、基集(非纯名字点)、`path` 非空数。
import { DatabaseSync } from 'node:sqlite';

export const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** 树内 = 祖先闭包;对照别名 e = entities(v30) / points 兼容视图(v31) */
export const CLOSURE =
  "WITH RECURSIVE up(id) AS (SELECT id FROM entities WHERE is_cited = 1 " +
  "UNION SELECT s.source_id FROM edges s JOIN up ON s.target_id = up.id WHERE s.kind = 'child')";
const CARRY = (p) =>
  `e.id IN (SELECT d.id FROM entities d JOIN edges cl ON cl.kind = 'link' JOIN entities ca ON ca.id = cl.source_id ` +
  `WHERE cl.target_id IN (SELECT id FROM entities WHERE path = ${q(p)}) AND ca.path IS NOT NULL ` +
  `AND (d.path = ca.path OR substr(d.path, 1, length(ca.path) + 1) = ca.path || '/'))`;
const tagSql = (p, selfOnly) =>
  `EXISTS (SELECT 1 FROM edges l JOIN entities t ON t.id = l.target_id WHERE l.kind = 'link' AND l.source_id = e.id ` +
  `AND (t.path = ${q(p)}${selfOnly ? '' : ` OR substr(t.path, 1, length(${q(p)}) + 1) = ${q(p)} || '/'`} OR ${CARRY(p)}))`;
const ANY_TAG = "EXISTS (SELECT 1 FROM edges l WHERE l.kind = 'link' AND l.source_id = e.id)";

export const itemSql = (it) => {
  const s = String(it.value ?? '').trim();
  if (it.kind === 'keyword')
    return !s
      ? null
      : s.length >= 3
        ? `e.id IN (SELECT rowid FROM entities_fts WHERE entities_fts MATCH ${q(`"${s.replace(/"/g, '""')}"*`)})`
        : `(e.meta LIKE ${q(`%${s}%`)} OR EXISTS (SELECT 1 FROM edges l JOIN entities t ON t.id = l.target_id WHERE l.kind = 'link' AND l.source_id = e.id AND (t.path LIKE ${q(`%${s}%`)} OR t.meta LIKE ${q(`%${s}%`)})))`;
  if (it.kind === 'tag') return tagSql(it.path, !it.includeChildren);
  if (it.kind === 'excludeTag') return `NOT ${tagSql(it.path, !it.includeChildren)}`;
  if (it.kind === 'relation') return CARRY(it.path);
  if (it.kind === 'excludeRelation') return `NOT (${CARRY(it.path)})`;
  if (it.kind === 'presence') return s === 'any' ? ANY_TAG : s === 'none' ? `NOT (${ANY_TAG})` : null;
  if (it.kind === 'treeMembership') return s === 'in' ? 'e.id IN (SELECT id FROM up)' : s === 'out' ? 'NOT (e.id IN (SELECT id FROM up))' : null;
  if (it.kind === 'singleLine') return s === 'multi' ? 'instr(e.meta, char(10)) > 0' : s === 'single' ? 'instr(e.meta, char(10)) = 0' : null;
  if (it.kind === 'expr') {
    if (!s) return null;
    throw new Error(`库侧读数不支持表达式条件:${s}`);
  }
  return null;
};

/** 前端回写后是 groups 形态;迁移遗留的平铺形态按同一次序摊平成 and 组。 */
export const groupsOf = (f) =>
  Array.isArray(f.groups) && f.groups.length
    ? f.groups
    : [{ op: 'and', items: [
        ...((f.keyword ?? '').trim() ? [{ kind: 'keyword', value: f.keyword }] : []),
        ...(f.tags ?? []).map((t) => ({ kind: 'tag', ...t })),
        ...(f.excludeTags ?? []).map((t) => ({ kind: 'excludeTag', ...t })),
        ...(f.relations ?? []).map((r) => ({ kind: 'relation', path: r.path })),
        ...(f.excludeRelations ?? []).map((r) => ({ kind: 'excludeRelation', path: r.path })),
        ...(f.tagPresence ? [{ kind: 'presence', value: f.tagPresence }] : []),
        ...((f.expr ?? '').trim() ? [{ kind: 'expr', value: f.expr }] : []),
      ] }];

/** 现场编译当前筛选的库侧命中数;`count(sql)` 返回单值(走只读兼容连接)。
 *  `base` 为基集谓词(v30 `1=1`,v31 传 `NOT_PURE_V31` 排除纯名字点)。 */
export function dbFilterHits(count, f, base = '1=1') {
  const gs = groupsOf(f)
    .map((g) => {
      const p = (g.items ?? []).map(itemSql).filter(Boolean);
      return p.length ? `(${p.join(g.op === 'or' ? ' OR ' : ' AND ')})` : null;
    })
    .filter(Boolean);
  const cond = gs.length ? `(${gs.join(f.groupOp === 'or' ? ' OR ' : ' AND ')})` : '1=1';
  return count(`${CLOSURE} SELECT COUNT(*) n FROM entities e WHERE (${base}) AND ${cond}`);
}

/** v31 基集谓词(spec §5.2):`entities` 兼容视图别名 `e`,原生 `lines.name_id` 判纯名字点。 */
export const NOT_PURE_V31 =
  'e.id <> 0 AND NOT (EXISTS(SELECT 1 FROM lines nl WHERE nl.name_id = e.id) ' +
  'AND NOT EXISTS(SELECT 1 FROM lines tl WHERE tl.from_id = e.id OR tl.to_id = e.id))';

/** 基集口径(spec §5.4-⑧):不含保留点 id=0,不含纯名字点(只出现在 name_id 位、不在任何线两端)。 */
const NOT_PURE =
  'p.id <> 0 AND NOT (EXISTS(SELECT 1 FROM lines nl WHERE nl.name_id = p.id) ' +
  'AND NOT EXISTS(SELECT 1 FROM lines tl WHERE tl.from_id = p.id OR tl.to_id = p.id))';

/**
 * 直读 v31 副本的原生读数(原生 `points` / `lines`,不装兼容视图):
 *   closure     = 递归闭包(is_cited 起点 + name_id=0 的祖先)
 *   pathNotNull = 树内点数(`path IS NOT NULL`)
 *   nonPure     = 基集点数(非纯名字点)
 * 正常迁移下 closure == pathNotNull(真库 742);把 031 的 child 映射改成 NULL 会让两者分叉。
 */
export function v31CopyReadings(path) {
  const db = new DatabaseSync('file:' + path, { readOnly: true });
  try {
    const one = (sql) => db.prepare(sql).get().n;
    return {
      closure: one(
        'WITH RECURSIVE c(id) AS (SELECT id FROM points WHERE is_cited = 1 ' +
          'UNION SELECT l.from_id FROM lines l JOIN c ON c.id = l.to_id WHERE l.name_id = 0) SELECT COUNT(*) n FROM c',
      ),
      pathNotNull: one('SELECT COUNT(*) n FROM points WHERE path IS NOT NULL'),
      nonPure: one(`SELECT COUNT(*) n FROM points p WHERE ${NOT_PURE}`),
    };
  } finally {
    db.close();
  }
}

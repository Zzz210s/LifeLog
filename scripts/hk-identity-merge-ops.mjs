/**
 * 「地点/香港身份」并入「地点/中国香港」(2026-10-07 写库脚本)。
 * 语义风险:`香港身份` = "有香港身份"(身份/状态),目标 `中国香港` 是"身处此地"(地点)。
 * 真库读数:源挂 3 条笔记且**全部**已挂目标(标题都形如「中国香港-…」),笔记覆盖零新增。
 * 语义照 Rust `tags::merge_core`(db/repos/tags/merge.rs):笔记链接取并集、子标签整棵搬
 * (path/depth 重写)、出入边取并集(R3 剔环)、删源、写 `tag_merge_log`;另按 Rust
 * `filter_rewrite.rs` 口径做 `filter_current` 路径级联(精确或 `old + '/'` 前缀),否则筛选静默筛空。
 * 默认空跑;`--apply` 才写库(先 VACUUM INTO —— WAL 下 copyFileSync 会丢 -wal,再开事务)。
 * 用法: node --experimental-strip-types scripts/hk-identity-merge-ops.mjs <db 路径> [--apply]
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tagLabelPlain } from '../src/shared/tag-label-plain.ts';
const [dbPath, ...flags] = process.argv.slice(2);
const APPLY = flags.includes('--apply');
if (!dbPath || !existsSync(dbPath)) {
  console.error('用法: node --experimental-strip-types scripts/hk-identity-merge-ops.mjs <db 路径> [--apply]');
  process.exit(2);
}
const SRC_PATH = '地点/香港身份';
const DST_PATH = '地点/中国香港';
const db = new DatabaseSync(dbPath, { readOnly: !APPLY, enableForeignKeyConstraints: true });
/** `tag_plain` 是 Rust 侧注册的连接级标量函数(迁移 018 的 FTS 触发器依赖它);以共享向量自检。 */
const vectors = JSON.parse(readFileSync('fixtures/tag-label.json', 'utf8'));
const cases = Array.isArray(vectors) ? vectors : (vectors.cases ?? []);
const bad = cases.filter((c) => tagLabelPlain(c.raw) !== c.plain);
if (bad.length > 0) {
  console.error(`tag_plain 自检失败(${bad.length}/${cases.length}),拒绝执行`);
  process.exit(3);
}
db.function('tag_plain', { deterministic: true }, (raw) => tagLabelPlain(String(raw ?? '')));
const q = (s, ...a) => db.prepare(s).all(...a);
const one = (s, ...a) => db.prepare(s).get(...a);
const cnt = (s, ...a) => one(s, ...a).c;
const tagOf = (p) => one('SELECT id, path, depth FROM tags WHERE path = ?', p);

const src = tagOf(SRC_PATH);
const dst = tagOf(DST_PATH);
if (!src || !dst) {
  console.error(`前置校验失败:标签不存在 (${SRC_PATH}=${src?.id}, ${DST_PATH}=${dst?.id})`);
  process.exit(3);
}
const subtree = q(
  `WITH RECURSIVE s(id, depth) AS (SELECT id, depth FROM tags WHERE id = ?1
     UNION ALL SELECT t.id, t.depth FROM tags t JOIN s ON t.parent_id = s.id)
   SELECT id FROM s ORDER BY depth DESC`,
  src.id,
).map((r) => r.id);
const srcNotes = q("SELECT target_id FROM tag_links WHERE tag_id=? AND target_type='note' ORDER BY target_id", src.id).map((r) => r.target_id);
const dstNotes = new Set(q("SELECT target_id FROM tag_links WHERE tag_id=? AND target_type='note'", dst.id).map((r) => r.target_id));
const overlap = srcNotes.filter((n) => dstNotes.has(n));
const affected = q(
  `SELECT DISTINCT target_id FROM tag_links WHERE target_type='note' AND tag_id IN (${subtree.map(() => '?').join(',')}) ORDER BY target_id`,
  ...subtree,
).map((r) => r.target_id);
const children = q('SELECT id, name, path FROM tags WHERE parent_id=? ORDER BY sort_order, path', src.id);
const outEdges = q("SELECT target_id AS y, remark FROM tag_links WHERE tag_id=? AND target_type='tag' ORDER BY target_id", src.id);
const inEdges = q("SELECT tag_id AS y, remark FROM tag_links WHERE target_id=? AND target_type='tag' ORDER BY tag_id", src.id);
const aliases = cnt('SELECT COUNT(*) c FROM tag_aliases WHERE tag_id=?', src.id);
const filterRaw = one("SELECT value FROM settings WHERE key='filter_current'")?.value ?? '';
const filterRefs = filterRaw.includes(SRC_PATH);
const before = {
  tags: cnt('SELECT COUNT(*) c FROM tags'),
  notes: cnt('SELECT COUNT(*) c FROM notes'),
  links: cnt('SELECT COUNT(*) c FROM tag_links'),
  edges: cnt("SELECT COUNT(*) c FROM tag_links WHERE target_type='tag'"),
  fts: cnt('SELECT COUNT(*) c FROM notes_fts'),
  dstSelf: dstNotes.size,
};

console.log(`库: ${dbPath}${APPLY ? '  [--apply 会真写]' : '  [dry-run 不写库]'}`);
console.log(`tag_plain 自检通过(${cases.length} 条共享向量);user_version=${one('PRAGMA user_version').user_version}`);
console.log(`源 ${SRC_PATH} id=${src.id} depth=${src.depth} -> 目标 ${DST_PATH} id=${dst.id} depth=${dst.depth}`);
console.log(`计划:笔记链接 ${srcNotes.length} 条转移(与目标重叠 ${overlap.length} 条,主键 IGNORE 丢弃,净新增 ${srcNotes.length - overlap.length})`);
console.log(`      子树标签 ${subtree.length} 个 / 直接子标签 ${children.length} 个:${children.map((c) => c.path).join(', ') || '(无)'};出入边 ${outEdges.length} 出 / ${inEdges.length} 入;源别名 ${aliases} 条(随删源级联)`);
console.log(`      filter_current 引用源路径:${filterRefs ? '是 -> 按前缀规则级联改写' : '否'}`);
console.log(`--- 源标签所挂笔记(语义判据,最多 10 条) ---`);
for (const n of q(
  `SELECT n.id, n.content FROM notes n WHERE n.id IN (${srcNotes.map(() => '?').join(',') || 'NULL'}) ORDER BY n.id LIMIT 10`,
  ...srcNotes,
)) {
  const title = (n.content.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 60);
  console.log(`  ${n.id}${dstNotes.has(n.id) ? ' [已挂目标]' : ' [仅源]'} | ${title}`);
}
if (!APPLY) {
  console.log('\ndry-run 结束。确认以上读数后再 --apply。');
  process.exit(0);
}
const backup = dbPath.replace(/\.db$/, '--pre-hk-identity-merge-backup.db');
if (existsSync(backup)) rmSync(backup);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log('\n已备份(VACUUM INTO):', backup);

/** 沿关系方向能否从 from 走到 to(并入出边判环,R3) */
const reaches = (from, to) => one(
  `WITH RECURSIVE w(id) AS (SELECT ?1 UNION SELECT l.target_id FROM tag_links l JOIN w ON l.tag_id = w.id
     WHERE l.target_type='tag') SELECT 1 AS hit FROM w WHERE id = ?2 LIMIT 1`, from, to) !== undefined;
/** 路径前缀改写(Rust filter_rewrite::rewrite_path 同口径):精确等于或 old + '/' 前缀 */
const rewritePath = (p, old, neu) => (p === old ? neu : (p.startsWith(old + '/') ? neu + p.slice(old.length) : null));
/** filter_current 的 tags/excludeTags/relations/excludeRelations/sorts/groupBy 路径级联;无改动回 null */
const rewriteFilter = (raw, old, neu) => {
  let c;
  try { c = JSON.parse(raw); } catch { return null; }
  let changed = false;
  const bump = (obj) => {
    if (obj && typeof obj.path === 'string') {
      const n = rewritePath(obj.path, old, neu);
      if (n !== null) { obj.path = n; changed = true; }
    }
  };
  for (const g of c.groups ?? []) for (const it of g.items ?? []) bump(it);
  for (const s of c.sorts ?? []) bump(s);
  bump(c.groupBy);
  return changed ? JSON.stringify(c) : null;
};

db.exec('BEGIN');
try {
  db.prepare(`INSERT INTO tag_merge_log(source_tag_id, target_tag_id, moved_child_ids, note_links, edges)
              VALUES(?,?,?,?,?)`)
    .run(src.id, dst.id, JSON.stringify(children.map((c) => c.id)), srcNotes.length, outEdges.length + inEdges.length);
  // ① 子标签整棵搬(目标下已有 raw 同名子标签时拒绝,免得撞唯一索引)
  const base = one('SELECT COALESCE(MAX(sort_order),-1)+1 AS b FROM tags WHERE parent_id=?', dst.id).b;
  children.forEach((c, i) => {
    const clash = one('SELECT id FROM tags WHERE COALESCE(parent_id,0)=COALESCE(?,0) AND name=? AND id<>?', dst.id, c.name, c.id);
    if (clash) throw new Error(`目标下已有同名子标签 ${c.path}(id=${clash.id}),请先在应用里合并`);
    db.prepare('UPDATE tags SET parent_id=?, sort_order=? WHERE id=?').run(dst.id, base + i, c.id);
  });
  if (children.length > 0) {
    db.prepare(`UPDATE tags SET path = ?2 || substr(path, length(?1)+1), depth = depth + ?3
                WHERE length(path) > length(?1) AND substr(path, 1, length(?1)+1) = ?1 || '/'`)
      .run(src.path, dst.path, dst.depth - src.depth);
  }
  // ② 笔记链接整行转移:目标已有同一笔记的链接时被主键挡下,不计入 moved
  const moved = db.prepare("UPDATE OR IGNORE tag_links SET tag_id=? WHERE tag_id=? AND target_type='note'").run(dst.id, src.id).changes;
  // ③ 出入边取并集(自环/成环剔除),属性名随边搬
  let edges = 0;
  const addEdge = db.prepare("INSERT OR IGNORE INTO tag_links(tag_id,target_type,target_id,remark) VALUES(?,'tag',?,?)");
  for (const e of outEdges) if (e.y !== dst.id && !reaches(e.y, dst.id)) edges += addEdge.run(dst.id, e.y, e.remark).changes;
  for (const e of inEdges) if (e.y !== dst.id && !reaches(dst.id, e.y)) edges += addEdge.run(e.y, dst.id, e.remark).changes;
  // ④ 筛选条件级联(应用侧 merge_core -> finish_core 也做这一步;不做就是筛选静默筛空)
  const nextFilter = filterRefs ? rewriteFilter(filterRaw, SRC_PATH, DST_PATH) : null;
  if (nextFilter !== null) {
    db.prepare("UPDATE settings SET value=? WHERE key='filter_current'").run(nextFilter);
  }
  // ⑤ 清源残余链接 + 删源(外键级联兜底)
  db.prepare('DELETE FROM tag_links WHERE tag_id=?').run(src.id);
  db.prepare("DELETE FROM tag_links WHERE target_type='tag' AND target_id=?").run(src.id);
  db.prepare('DELETE FROM tags WHERE id=?').run(src.id);
  // ⑥ FTS:tag_links 自迁移 003 起只有 INSERT/DELETE 触发器,UPDATE tag_id 不触发 ->
  //    对受影响笔记把转移后的链接删掉再插一次,让产品自带触发器按当前树重算 notes_fts
  const delLink = db.prepare("DELETE FROM tag_links WHERE tag_id=? AND target_type='note' AND target_id=?");
  const insLink = db.prepare("INSERT INTO tag_links(tag_id,target_type,target_id) VALUES(?,'note',?)");
  for (const n of affected) {
    delLink.run(dst.id, n);
    insLink.run(dst.id, n);
  }
  // ⑦ 孤儿回收(与 Rust gc_orphans 同条件,循环到不动点)
  for (;;) {
    const n = db.prepare(`DELETE FROM tags
      WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = tags.id)
        AND NOT EXISTS (SELECT 1 FROM tag_links c WHERE c.target_type IN ('tag','type') AND c.target_id = tags.id)
        AND NOT EXISTS (SELECT 1 FROM tags ch WHERE ch.parent_id = tags.id)`).run().changes;
    if (n === 0) break;
  }
  db.exec('COMMIT');
  console.log(`事务提交:笔记链接 moved=${moved},子标签=${children.length},并入边=${edges},filter 改写=${nextFilter !== null}`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('失败已回滚:', err.message);
  process.exit(1);
}

const after = {
  tags: cnt('SELECT COUNT(*) c FROM tags'),
  notes: cnt('SELECT COUNT(*) c FROM notes'),
  links: cnt('SELECT COUNT(*) c FROM tag_links'),
  edges: cnt("SELECT COUNT(*) c FROM tag_links WHERE target_type='tag'"),
  fts: cnt('SELECT COUNT(*) c FROM notes_fts'),
  dstSelf: cnt("SELECT COUNT(*) c FROM tag_links WHERE tag_id=? AND target_type='note'", dst.id),
  srcTag: cnt('SELECT COUNT(*) c FROM tags WHERE id=?', src.id),
  srcLinks: cnt("SELECT COUNT(*) c FROM tag_links WHERE tag_id=? OR (target_type='tag' AND target_id=?)", src.id, src.id),
  dangling: cnt("SELECT COUNT(*) c FROM tag_links WHERE target_type='tag' AND target_id NOT IN (SELECT id FROM tags)"),
  ftsDrift: cnt(`SELECT COUNT(*) c FROM notes n WHERE NOT EXISTS (SELECT 1 FROM notes_fts f WHERE f.rowid=n.id)`),
  integrity: one('PRAGMA integrity_check').integrity_check,
  version: one('PRAGMA user_version').user_version,
  logs: cnt('SELECT COUNT(*) c FROM tag_merge_log WHERE source_tag_id=? AND target_tag_id=?', src.id, dst.id),
};
const curFilter = one("SELECT value FROM settings WHERE key='filter_current'")?.value ?? '';
console.log('对账:');
console.log(`  标签 ${before.tags} -> ${after.tags}(应 ${before.tags - 1})`);
console.log(`  笔记 ${before.notes} -> ${after.notes}(应不变)`);
console.log(`  tag_links ${before.links} -> ${after.links}(应 -${overlap.length}:重叠行随删源去掉)`);
console.log(`  关系边 ${before.edges} -> ${after.edges}(应不变:源无出入边)`);
console.log(`  notes_fts ${before.fts} -> ${after.fts}(应不变);缺 FTS 行的笔记 ${after.ftsDrift}(应 0)`);
console.log(`  ${DST_PATH} 本级笔记 ${before.dstSelf} -> ${after.dstSelf}(应 +${srcNotes.length - overlap.length})`);
console.log(`  ${SRC_PATH} 残留:标签 ${after.srcTag} / 链接 ${after.srcLinks}(都应 0)`);
console.log(`  悬空 tag 型边:${after.dangling}(应 0);merge_log:${after.logs} 条(应 1)`);
console.log(`  filter_current 仍引用源路径:${curFilter.includes(SRC_PATH) ? '是(异常)' : '否'}`);
console.log(`  integrity:${after.integrity};user_version:${after.version}`);

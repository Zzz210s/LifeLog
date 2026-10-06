/**
 * 「地点/中国」并入「地点/中国大陆」(2026-10-06 用户拍板):中国是空壳式重复项,
 * 16 位作者的笔记挂的是它,省市树挂在中国大陆下 —— 归并到中国大陆。
 *
 * 语义照 Rust `tags::merge_core`(src-tauri/src/db/repos/tags/merge.rs):
 * 笔记链接整行转给目标(主键去重取并集)、子标签整棵搬(path/depth 同步重写)、
 * 出入边取并集(会成环/自环的按 R3 剔除)、删源,并写一条 tag_merge_log
 * (源/目标 id、搬走的子标签、笔记链接数、关系边数)。
 * 本脚本额外 fail-closed:filter_current 仍引用源路径时拒绝执行(应用侧会做路径级联)。
 *
 * 默认**空跑只打印**;`--apply` 才写库(先 VACUUM INTO 备份 + 单事务)。
 * 用法: node --experimental-strip-types scripts/cn-merge-ops.mjs <db 路径> [--apply]
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tagLabelPlain } from '../src/shared/tag-label-plain.ts';

const [dbPath, ...flags] = process.argv.slice(2);
const APPLY = flags.includes('--apply');
if (!dbPath || !existsSync(dbPath)) {
  console.error('用法: node --experimental-strip-types scripts/cn-merge-ops.mjs <db 路径> [--apply]');
  process.exit(2);
}
const SRC_PATH = '地点/中国';
const DST_PATH = '地点/中国大陆';

const db = new DatabaseSync(dbPath, { readOnly: !APPLY, enableForeignKeyConstraints: true });
/**
 * `tag_plain` 是 Rust 侧注册的连接级标量函数(迁移 018 的 FTS 触发器依赖它,记忆 #990)。
 * 用前端同源实现并以共享向量自检:对不上就拒绝执行。
 */
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
const srcNotes = q("SELECT target_id FROM tag_links WHERE tag_id=? AND target_type='note' ORDER BY target_id", src.id).map((r) => r.target_id);
const dstNotes = new Set(q("SELECT target_id FROM tag_links WHERE tag_id=? AND target_type='note'", dst.id).map((r) => r.target_id));
const overlap = srcNotes.filter((n) => dstNotes.has(n));
const children = q('SELECT id, name, path FROM tags WHERE parent_id=? ORDER BY sort_order, path', src.id);
const outEdges = q("SELECT target_id AS y, remark FROM tag_links WHERE tag_id=? AND target_type='tag' ORDER BY target_id", src.id);
const inEdges = q("SELECT tag_id AS y, remark FROM tag_links WHERE target_id=? AND target_type='tag' ORDER BY tag_id", src.id);
const filter = one("SELECT value FROM settings WHERE key='filter_current'")?.value ?? '';
const filterRefs = filter.includes(SRC_PATH);
const before = {
  tags: cnt('SELECT COUNT(*) c FROM tags'),
  notes: cnt('SELECT COUNT(*) c FROM notes'),
  links: cnt('SELECT COUNT(*) c FROM tag_links'),
  dstSelf: dstNotes.size,
};

console.log(`库: ${dbPath}${APPLY ? '  [--apply 会真写]' : '  [dry-run 不写库]'}`);
console.log(`tag_plain 自检通过(${cases.length} 条共享向量)`);
console.log(`源 ${SRC_PATH} id=${src.id} depth=${src.depth} -> 目标 ${DST_PATH} id=${dst.id} depth=${dst.depth}`);
console.log(`计划:笔记链接 ${srcNotes.length} 条转移(与目标重叠 ${overlap.length} 条,主键 IGNORE 丢弃)`);
console.log(`      子标签 ${children.length} 个:${children.map((c) => c.path).join(', ') || '(无)'}`);
console.log(`      出入边 ${outEdges.length} 条出 / ${inEdges.length} 条入`);
console.log(`      filter_current 引用源路径:${filterRefs ? '是(拒绝执行)' : '否'}`);
if (filterRefs) {
  console.error('filter_current 仍引用源路径,应用侧会做路径级联;请先在应用里改条件再执行');
  process.exit(3);
}
if (!APPLY) {
  console.log('\ndry-run 结束。确认以上读数后再 --apply。');
  process.exit(0);
}

const backup = dbPath.replace(/\.db$/, '--pre-cn-merge-backup.db');
if (existsSync(backup)) rmSync(backup);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log('\n已备份(VACUUM INTO):', backup);

/** 沿关系方向能否从 from 走到 to(并入出边判环,R3) */
const reaches = (from, to) => one(
  `WITH RECURSIVE w(id) AS (SELECT ?1 UNION SELECT l.target_id FROM tag_links l JOIN w ON l.tag_id = w.id
     WHERE l.target_type='tag') SELECT 1 AS hit FROM w WHERE id = ?2 LIMIT 1`, from, to) !== undefined;

db.exec('BEGIN');
try {
  db.prepare(`INSERT INTO tag_merge_log(source_tag_id, target_tag_id, moved_child_ids, note_links, edges)
              VALUES(?,?,?,?,?)`)
    .run(src.id, dst.id, JSON.stringify(children.map((c) => c.id)), srcNotes.length, outEdges.length + inEdges.length);
  // ① 子标签整棵搬(本例无;目标下已存在 raw 同名子标签时拒绝,免得踩唯一索引)
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
  // ④ 清源残余链接 + 删源(外键级联兜底)
  db.prepare('DELETE FROM tag_links WHERE tag_id=?').run(src.id);
  db.prepare("DELETE FROM tag_links WHERE target_type='tag' AND target_id=?").run(src.id);
  db.prepare('DELETE FROM tags WHERE id=?').run(src.id);
  // ⑤ FTS:tag_links 自迁移 003 起只有 INSERT/DELETE 触发器,UPDATE tag_id 不触发 ->
  //    对每条受影响笔记把转移后的链接删掉再插一次,让产品自带触发器按当前树重算 notes_fts
  //    (与 Rust refresh_fts 同结果,不必复制聚合 SQL)。
  const delLink = db.prepare("DELETE FROM tag_links WHERE tag_id=? AND target_type='note' AND target_id=?");
  const insLink = db.prepare("INSERT INTO tag_links(tag_id,target_type,target_id) VALUES(?,'note',?)");
  for (const n of srcNotes) {
    delLink.run(dst.id, n);
    insLink.run(dst.id, n);
  }
  // ⑥ 孤儿回收(与 Rust gc_orphans 同条件,循环到不动点)
  for (;;) {
    const n = db.prepare(`DELETE FROM tags
      WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = tags.id)
        AND NOT EXISTS (SELECT 1 FROM tag_links c WHERE c.target_type IN ('tag','type') AND c.target_id = tags.id)
        AND NOT EXISTS (SELECT 1 FROM tags ch WHERE ch.parent_id = tags.id)`).run().changes;
    if (n === 0) break;
  }
  db.exec('COMMIT');
  console.log(`事务提交:笔记链接 moved=${moved},子标签=${children.length},并入边=${edges}`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('失败已回滚:', err.message);
  process.exit(1);
}

const after = {
  tags: cnt('SELECT COUNT(*) c FROM tags'),
  notes: cnt('SELECT COUNT(*) c FROM notes'),
  links: cnt('SELECT COUNT(*) c FROM tag_links'),
  dstSelf: cnt("SELECT COUNT(*) c FROM tag_links WHERE tag_id=? AND target_type='note'", dst.id),
  srcTag: cnt('SELECT COUNT(*) c FROM tags WHERE id=?', src.id),
  srcLinks: cnt("SELECT COUNT(*) c FROM tag_links WHERE tag_id=? OR (target_type='tag' AND target_id=?)", src.id, src.id),
  dangling: cnt("SELECT COUNT(*) c FROM tag_links WHERE target_type='tag' AND target_id NOT IN (SELECT id FROM tags)"),
  integrity: one('PRAGMA integrity_check').integrity_check,
  version: one('PRAGMA user_version').user_version,
  logs: cnt('SELECT COUNT(*) c FROM tag_merge_log WHERE source_tag_id=? AND target_tag_id=?', src.id, dst.id),
};
console.log('对账:');
console.log(`  标签 ${before.tags} -> ${after.tags}(应 ${before.tags - 1}:源被删)`);
console.log(`  笔记 ${before.notes} -> ${after.notes}(应不变)`);
console.log(`  tag_links ${before.links} -> ${after.links}(应不变:笔记链接只换 target)`);
console.log(`  ${DST_PATH} 本级笔记 ${before.dstSelf} -> ${after.dstSelf}(应 +${srcNotes.length - overlap.length})`);
console.log(`  ${SRC_PATH} 残留:标签 ${after.srcTag} / 链接 ${after.srcLinks}(都应 0)`);
console.log(`  悬空 tag 型边:${after.dangling}(应 0);merge_log:${after.logs} 条(应 1)`);
console.log(`  integrity:${after.integrity};user_version:${after.version}`);

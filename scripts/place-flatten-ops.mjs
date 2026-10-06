/**
 * 地点标签扁平化 + 轴标签独立(2026-10-04 设计,spec: docs/superpowers/specs/2026-10-04-place-flatten.md)
 *
 * 三步(顺序不可颠倒):
 *   A 补轴链接 —— 四个轴(所在/要求/产地/国籍)把"后代标签所挂的笔记"直接挂到自己身上
 *     (轴现在没有本级笔记;不先补,第 B 步搬走子标签后就再也算不出"原来标注的条目")
 *   B 搬子标签 —— 四个轴的 107 个子标签全部移到 `地点` 下;同名者合并(链接改指存活的那个)
 *   C 建新根 —— 新建根标签 `地点轴`,把四个轴搬过去
 *
 * 用法:
 *   node --experimental-strip-types scripts/place-flatten-ops.mjs <db 路径>            # 默认 dry-run
 *   node --experimental-strip-types scripts/place-flatten-ops.mjs <db 路径> --apply    # 真写(先快照 + 应用已退出)
 *
 * 纪律:先对**库副本**跑 dry-run,逐项对账后再对真库 --apply。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tagLabelPlain } from '../src/shared/tag-label-plain.ts';

const [dbPath, ...flags] = process.argv.slice(2);
const APPLY = flags.includes('--apply');
if (!dbPath) {
  console.error('用法: node scripts/place-flatten-ops.mjs <db 路径> [--apply]');
  process.exit(2);
}
if (!existsSync(dbPath)) {
  console.error('找不到库文件:', dbPath);
  process.exit(2);
}

const PLACE = '地点';
const AXIS_ROOT = '地点轴';
const AXES = ['所在', '要求', '产地', '国籍'];

const db = new DatabaseSync(dbPath, { readOnly: !APPLY });
/**
 * `tag_plain` 是 **Rust 侧注册的连接级 SQL 标量函数**(迁移 018 的 FTS 触发器要用它),
 * 外部进程直连库写 `tag_links` 会撞 `no such function: tag_plain` 并整事务回滚
 * (migrate.rs 的注释里就写着这个坑)。这里挂上**前端同源实现**(两侧由共享向量钉住一致),
 * 并用同一份向量自检:对不上就拒绝执行,绝不带着错口径写库。
 */
const vectors = JSON.parse(readFileSync('fixtures/tag-label.json', 'utf8'));
const cases = Array.isArray(vectors) ? vectors : (vectors.cases ?? []);
const bad = cases.filter((c) => tagLabelPlain(c.raw) !== c.plain);
if (bad.length > 0) {
  console.error(`tag_plain 自检失败(${bad.length}/${cases.length} 条与共享向量不一致),拒绝执行:`);
  for (const b of bad.slice(0, 3)) console.error(`  ${b.raw} -> ${tagLabelPlain(b.raw)} 应为 ${b.plain}`);
  process.exit(3);
}
db.function('tag_plain', { deterministic: true }, (raw) => tagLabelPlain(String(raw ?? '')));
console.log(`tag_plain 自检通过(${cases.length} 条共享向量)`);
const tagOf = (path) => db.prepare('SELECT id, parent_id FROM tags WHERE path = ?').get(path);
/** `.get()` 查不到返回 undefined(不是 null)——判断存在必须用这个,别写 `!== null` */
const hasTag = (path) => tagOf(path) !== undefined;
const childTags = (id) => db.prepare('SELECT id, path FROM tags WHERE parent_id = ? ORDER BY id').all(id);
const noteIdsOf = (tagId) => db.prepare("SELECT target_id FROM tag_links WHERE tag_id = ? AND target_type = 'note'").all(tagId).map((r) => r.target_id);
const noteIdsUnder = (prefix) =>
  db.prepare("SELECT DISTINCT target_id FROM tag_links WHERE target_type = 'note' AND tag_id IN (SELECT id FROM tags WHERE path LIKE ?)")
    .all(prefix + '/%')
    .map((r) => r.target_id);

/**
 * 移动一个标签子树:parent_id 之外**必须重写 path 与 depth**(全库路径是物化的),
 * 只改 parent_id 会让 path 指向旧位置 —— 那是最坏的一类脏数据(筛选/补全/导出全跟着错)。
 */
const moveSubtree = (tagId, newParentId) => {
  const tag = db.prepare('SELECT id, name, path, depth FROM tags WHERE id = ?').get(tagId);
  const parent = db.prepare('SELECT path, depth FROM tags WHERE id = ?').get(newParentId);
  const newPath = `${parent.path}/${tag.name}`;
  const newDepth = parent.depth + 1;
  const shift = newDepth - tag.depth;
  db.prepare('UPDATE tags SET parent_id = ?, path = ?, depth = ? WHERE id = ?').run(newParentId, newPath, newDepth, tag.id);
  const kids = db.prepare('SELECT id, path FROM tags WHERE path LIKE ?').all(tag.path + '/%');
  const upd = db.prepare('UPDATE tags SET path = ?, depth = depth + ? WHERE id = ?');
  for (const k of kids) upd.run(newPath + k.path.slice(tag.path.length), shift, k.id);
};
const counts = () => ({
  notes: db.prepare('SELECT COUNT(*) c FROM notes').get().c,
  tags: db.prepare('SELECT COUNT(*) c FROM tags').get().c,
  links: db.prepare('SELECT COUNT(*) c FROM tag_links').get().c,
  roots: db.prepare('SELECT COUNT(*) c FROM tags WHERE parent_id IS NULL').get().c,
});
const before = counts();

const place = tagOf(PLACE);
if (!place) {
  console.error('找不到标签:', PLACE);
  process.exit(2);
}

// ---------- 计划 ----------
const planA = []; // { axis, axisId, notes: number[] }
for (const axis of AXES) {
  const path = `${PLACE}/${axis}`;
  const row = tagOf(path);
  if (!row) continue;
  const have = new Set(noteIdsOf(row.id));
  const all = noteIdsUnder(path);
  planA.push({ axis, axisId: row.id, notes: all.filter((n) => !have.has(n)), already: have.size, total: all.length });
}

const planB = []; // { fromId, fromPath, name, toId? }
const byName = new Map();
for (const axis of AXES) {
  const row = tagOf(`${PLACE}/${axis}`);
  if (!row) continue;
  for (const child of childTags(row.id)) {
    const name = child.path.slice(child.path.lastIndexOf('/') + 1);
    const hit = byName.get(name);
    if (hit) planB.push({ fromId: child.id, fromPath: child.path, name, moveTo: place.id, mergeInto: hit.id });
    else {
      byName.set(name, { id: child.id, path: child.path });
      planB.push({ fromId: child.id, fromPath: child.path, name, moveTo: place.id });
    }
  }
}
const merges = planB.filter((p) => p.mergeInto !== undefined);
const axisRootExists = hasTag(AXIS_ROOT);

// ---------- 打印 ----------
console.log(`库: ${dbPath}${APPLY ? '  [--apply 会真写]' : '  [dry-run 不写库]'}`);
console.log(`基线: ${before.notes} 笔记 / ${before.tags} 标签 / ${before.links} 链接 / ${before.roots} 个根\n`);
console.log('A 补轴链接(把后代标签的笔记直挂到轴):');
for (const a of planA) {
  console.log(`  ${PLACE}/${a.axis}: 现有本级 ${a.already} 条 -> 新增 ${a.notes.length} 条(含子级共 ${a.total} 条)`);
}
console.log(`  小计新增 ${planA.reduce((s, a) => s + a.notes.length, 0)} 条链接\n`);
console.log(`B 搬子标签到 ${PLACE} 下:共 ${new Set(planB.map((p) => p.fromId)).size} 个`);
console.log('  同名合并(每一组的双方计数):');
for (const m of merges) {
  const into = db.prepare('SELECT path FROM tags WHERE id = ?').get(m.mergeInto).path;
  console.log(`    ${m.fromPath}(${noteIdsOf(m.fromId).length} 条)  ->  并入 ${into}(${noteIdsOf(m.mergeInto).length} 条)`);
}
console.log(`  合并组数 ${merges.length};搬完 ${PLACE} 的直接子标签 = ${childTags(place.id).length - AXES.length + (new Set(planB.map((p) => p.name)).size)}\n`);
console.log(`C 新建根标签 ${AXIS_ROOT}:${axisRootExists ? ' 已存在(跳过创建)' : ' 待创建'};四个轴搬入\n`);

if (!APPLY) {
  console.log('dry-run 结束。确认以上读数后,对库副本 --apply 复跑,再对真库执行。');
  process.exit(0);
}

// ---------- 执行 ----------
/**
 * 备份必须在**写之前**,且用 `VACUUM INTO` 生成单文件全量快照。
 * 库是 WAL 模式:`copyFileSync` 只拷 .db、丢掉 -wal 里尚未 checkpoint 的事务 ——
 * 实测拷出来的副本 `user_version` 退回 22、下游查询报 `no such column: l.remark`(整个迁移 023 没了)。
 */
const backupPath = dbPath.replace(/\.db$/, '--pre-flatten-backup.db');
if (existsSync(backupPath)) rmSync(backupPath);
db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
console.log('已备份(VACUUM INTO):', backupPath);
const nextSort = () => (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 v FROM tags WHERE parent_id IS NULL').get().v ?? 1);
db.exec('BEGIN');
try {
  // A 补轴链接
  for (const a of planA) {
    const ins = db.prepare("INSERT OR IGNORE INTO tag_links (tag_id, target_type, target_id) VALUES (?, 'note', ?)");
    for (const note of a.notes) ins.run(a.axisId, note);
  }
  // B 搬 + 合并
  for (const p of planB) {
    if (p.mergeInto !== undefined) {
      // 合并:把源标签的链接改指目标,再删源标签(子标签此前已按同名前缀处理,故此处源已无子标签)
      db.prepare('UPDATE OR IGNORE tag_links SET tag_id = ? WHERE tag_id = ?').run(p.mergeInto, p.fromId);
      db.prepare('DELETE FROM tag_links WHERE tag_id = ?').run(p.fromId);
      db.prepare('DELETE FROM tags WHERE id = ?').run(p.fromId);
    } else {
      moveSubtree(p.fromId, p.moveTo);
    }
  }
  // C 新建根 + 搬轴
  let rootId = axisRootExists ? tagOf(AXIS_ROOT).id : null;
  if (rootId === null) {
    db.prepare('INSERT INTO tags (name, parent_id, path, depth, sort_order) VALUES (?, NULL, ?, 1, ?)').run(AXIS_ROOT, AXIS_ROOT, nextSort());
    rootId = tagOf(AXIS_ROOT).id;
  }
  for (const axis of AXES) {
    const row = tagOf(`${PLACE}/${axis}`);
    if (row) moveSubtree(row.id, rootId);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('失败已回滚:', e.message);
  process.exit(1);
}

const after = counts();
console.log('\n完成。对账:');
console.log(`  笔记 ${before.notes} -> ${after.notes}(应相等)`);
console.log(`  标签 ${before.tags} -> ${after.tags}(应 = 原 - 合并数 + 1 个新根)`);
console.log(`  链接 ${before.links} -> ${after.links}(应 = 原 + 新增轴链接 - 合并去重)`);
console.log(`  根标签 ${before.roots} -> ${after.roots}`);
console.log('  完整性:', db.prepare('PRAGMA integrity_check').get());

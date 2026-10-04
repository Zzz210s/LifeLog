/**
 * 「动词 + 地名」标签拆分(2026-10-04,接地点扁平化之后):
 *   旧: 地点/身处香港(23 条)   新: 地点/中国香港  +  地点轴/身处
 * 规则(用户已确认):
 *   - 地名按**末段名**在 `地点/*` 里找 `X` / `X市` / `中国X`;8 个中国城市按省份挂(吉林省/安徽省顺带新建)
 *   - `留居欧洲` -> 新建 `地点/欧洲`(区域);`留居海外` -> 不建地名,只留动词标签
 *   - 动词变成轴标签 `地点轴/身处|留居|逗留`(与 所在/产地/国籍/要求 平级)
 *   - 每条笔记同时挂「地名 + 动词」两个标签,再删掉旧的合成标签
 *
 * 用法(node 需要 --experimental-strip-types,因为要 import 前端同源的 tag_plain):
 *   node --experimental-strip-types scripts/place-verb-ops.mjs <db>            # dry-run
 *   node --experimental-strip-types scripts/place-verb-ops.mjs <db> --apply
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { tagLabelPlain } from '../src/shared/tag-label-plain.ts';

const [dbPath, ...flags] = process.argv.slice(2);
const APPLY = flags.includes('--apply');
if (!dbPath) {
  console.error('用法: node --experimental-strip-types scripts/place-verb-ops.mjs <db> [--apply]');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: !APPLY });
const vectors = JSON.parse(readFileSync('fixtures/tag-label.json', 'utf8'));
const cases = Array.isArray(vectors) ? vectors : (vectors.cases ?? []);
const bad = cases.filter((c) => tagLabelPlain(c.raw) !== c.plain);
if (bad.length > 0) {
  console.error('tag_plain 自检失败,拒绝执行');
  process.exit(3);
}
db.function('tag_plain', { deterministic: true }, (raw) => tagLabelPlain(String(raw ?? '')));

const PLACE = '地点';
const AXIS_ROOT = '地点轴';
const VERBS = ['身处', '留居', '逗留'];
/** 8 个待新建的城市 -> 省(用户确认按省份挂) */
const CITY_PROVINCE = {
  长春: '吉林省', 梅州: '广东省', 合肥: '安徽省', 长沙: '湖南省',
  威海: '山东省', 温州: '浙江省', 无锡: '江苏省', 武汉: '湖北省',
};

const q = (s, ...a) => db.prepare(s).all(...a);
const one = (s, ...a) => db.prepare(s).get(...a);
const tagOf = (path) => one('SELECT id, parent_id, path FROM tags WHERE path = ?', path);
const notesOf = (id) => q("SELECT target_id FROM tag_links WHERE tag_id = ? AND target_type = 'note'", id).map((r) => r.target_id);
const last = (p) => p.split('/').pop();

/** 按末段名找已有地名:精确 / +市 / 中国+X 三种形态 */
const findPlace = (name) => {
  const all = q("SELECT path FROM tags WHERE path LIKE '地点/%'");
  for (const cand of [name, name + '市', '中国' + name]) {
    const hit = all.find((r) => last(r.path) === cand);
    if (hit) return hit.path;
  }
  return null;
};

const plan = []; // { oldPath, oldId, notes, place, verb, createPlace? }
const placeToCreate = new Set();
for (const axis of VERBS) {
  for (const t of q("SELECT id, path FROM tags WHERE parent_id = (SELECT id FROM tags WHERE path = ?)", PLACE)) {
    const name = last(t.path);
    if (!name.startsWith(axis)) continue;
    const placeName = name.slice(axis.length);
    let place = findPlace(placeName);
    if (!place) {
      if (placeName === '海外') place = null; // 不是地名,只留动词标签
      else if (CITY_PROVINCE[placeName]) {
        place = `${PLACE}/中国大陆/${CITY_PROVINCE[placeName]}/${placeName}市`;
        placeToCreate.add(`${PLACE}/中国大陆/${CITY_PROVINCE[placeName]}`);
        placeToCreate.add(place);
      } else {
        place = `${PLACE}/${placeName}`; // 欧洲等区域
        placeToCreate.add(place);
      }
    }
    plan.push({ oldPath: t.path, oldId: t.id, notes: notesOf(t.id), place, verb: `${AXIS_ROOT}/${axis}` });
  }
}

console.log(`库: ${dbPath}${APPLY ? '  [--apply]' : '  [dry-run]'}`);
console.log(`待拆标签 ${plan.length} 个 / 涉及笔记 ${new Set(plan.flatMap((p) => p.notes)).size} 条`);
console.log('待新建标签:', [...placeToCreate].sort().join(' | ') || '(无)');
console.log('映射表:');
for (const p of plan) {
  console.log(`  ${p.oldPath}(${p.notes.length}条) -> ${p.place ?? '(不建地名)'} + ${p.verb}`);
}
if (!APPLY) {
  console.log('\ndry-run 结束。');
  process.exit(0);
}

/** 建标签(含缺失的祖先):parent_id 必须存在,path/depth 一并物化 */
const ensureTag = (path) => {
  const hit = tagOf(path);
  if (hit) return hit.id;
  const cut = path.lastIndexOf('/');
  const parentPath = cut < 0 ? null : path.slice(0, cut);
  const parentId = parentPath === null ? null : ensureTag(parentPath);
  const depth = parentPath === null ? 1 : parentPath.split('/').length + 1;
  const sort = one('SELECT COALESCE(MAX(sort_order), 0) + 1 v FROM tags WHERE parent_id IS ?', parentId).v ?? 1;
  db.prepare('INSERT INTO tags (name, parent_id, path, depth, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(last(path), parentId, path, depth, sort);
  return tagOf(path).id;
};

const before = {
  notes: one('SELECT COUNT(*) c FROM notes').c,
  tags: one('SELECT COUNT(*) c FROM tags').c,
  links: one('SELECT COUNT(*) c FROM tag_links').c,
};
db.exec('BEGIN');
try {
  for (const path of [...placeToCreate].sort()) ensureTag(path);
  for (const axis of VERBS) ensureTag(`${AXIS_ROOT}/${axis}`);
  const link = db.prepare("INSERT OR IGNORE INTO tag_links (tag_id, target_type, target_id) VALUES (?, 'note', ?)");
  for (const p of plan) {
    const placeId = p.place === null ? null : tagOf(p.place).id;
    const verbId = tagOf(p.verb).id;
    for (const note of p.notes) {
      if (placeId !== null) link.run(placeId, note);
      link.run(verbId, note);
    }
    db.prepare('DELETE FROM tag_links WHERE tag_id = ?').run(p.oldId);
    db.prepare('DELETE FROM tags WHERE id = ?').run(p.oldId);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('失败已回滚:', e.message);
  process.exit(1);
}
const after = {
  notes: one('SELECT COUNT(*) c FROM notes').c,
  tags: one('SELECT COUNT(*) c FROM tags').c,
  links: one('SELECT COUNT(*) c FROM tag_links').c,
};
console.log('\n完成。对账:');
console.log(`  笔记 ${before.notes} -> ${after.notes}(应相等)`);
console.log(`  标签 ${before.tags} -> ${after.tags}(应 = 原 − ${plan.length} + 新建)`);
console.log(`  链接 ${before.links} -> ${after.links}`);
console.log('  完整性:', one('PRAGMA integrity_check').integrity_check);
console.log('  depth 与段数不一致:', one("SELECT COUNT(*) c FROM tags WHERE depth != (LENGTH(path)-LENGTH(REPLACE(path,'/','')))+1").c);

/**
 * 「作者国籍」关系边重建(2026-10-06)。关系边口径:A --(属性名)--> B 读作「A 具有该属性,值是 B」。
 * 旧边 `作者/X --(空)--> 地点轴/国籍` 只声明「有国籍属性」、没有值,
 * 本脚本把它推断成 `作者/X --(国籍)--> 地点/<国家>`。
 *
 * 推断口径(用户定):
 *   - 「国家级」= `地点` 的直接子标签(depth 2,如 地点/日本、地点/中国香港)
 *   - 笔记只挂省级标签(地点/中国大陆/河北省/…)时,取其 **depth-2 祖先**(地点/中国大陆)
 *   - 中国的取值统一写 `地点/中国大陆`(2026-10-06 用户定):`地点/中国` 是空壳旧标签,省份树挂在中国大陆下
 *   - 一位作者:名下笔记(`tag_links` 里 `target_type='note'` 指向该作者标签)上出现的国家,
 *     按**笔记数**降序全列出;>1 个国家标「多值,需你选」
 *   - 同一笔记多个地点标签映射到同一国家只计一条
 *
 * 默认**空跑只打印**;`--apply` 才写库(先备份 + 事务)。真实库只读打开。
 * 用法: node --experimental-strip-types scripts/author-nation-ops.mjs <db 路径> [--apply]
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tagLabelPlain } from '../src/shared/tag-label-plain.ts';

const [dbPath, ...flags] = process.argv.slice(2);
const APPLY = flags.includes('--apply');
if (!dbPath) {
  console.error('用法: node --experimental-strip-types scripts/author-nation-ops.mjs <db 路径> [--apply]');
  process.exit(2);
}
if (!existsSync(dbPath)) {
  console.error('找不到库文件:', dbPath);
  process.exit(2);
}

const PLACE = '地点';
const OLD_TARGET = '地点轴/国籍'; // 旧边指向的「属性标签」,不是值
const ATTR = '国籍'; // 新边上的属性名(存 tag_links.remark)
const SUSPECT = new Set(['地点/香港身份', '地点/欧洲', '地点/苏联']); // depth2 但不是国家/地区
/** 国家级取值的别名映射:空壳/旧标签 -> 用户选定的规范标签(中国 -> 中国大陆) */
const NATION_ALIAS = new Map([['地点/中国', '地点/中国大陆']]);
const normalizeNation = (p) => NATION_ALIAS.get(p) ?? p;

const db = new DatabaseSync(dbPath, { readOnly: !APPLY });
/**
 * `tag_plain` 是 Rust 侧注册的连接级标量函数(迁移 018 的 FTS 触发器依赖它)。
 * 本轮不写库,但 --apply 时必须提前挂好,否则触发器报 `no such function: tag_plain`。
 * 用前端同源实现,并以共享向量自检:对不上就拒绝执行。
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
const tagOf = (path) => db.prepare('SELECT id, path, depth FROM tags WHERE path = ?').get(path);
const noteIdsOf = (id) => q("SELECT target_id FROM tag_links WHERE tag_id = ? AND target_type = 'note'", id).map((r) => r.target_id);
const placePathsOf = (noteId) =>
  q(`SELECT t.path FROM tag_links l JOIN tags t ON t.id = l.tag_id
     WHERE l.target_type = 'note' AND l.target_id = ? AND t.path LIKE ?`, noteId, `${PLACE}/%`).map((r) => r.path);
const noteTitle = (id) => ((db.prepare('SELECT content FROM notes WHERE id = ?').get(id)?.content ?? '').split('\n')[0] || '').trim().slice(0, 24);
/** 地点路径 -> 国家级祖先(depth 2);这是本脚本唯一的「国家级」判据 */
const nationOf = (path) => path.split('/').slice(0, 2).join('/');

const oldTarget = tagOf(OLD_TARGET);
const oldEdges = q(`SELECT l.tag_id, l.target_id, s.path autor
  FROM tag_links l JOIN tags s ON s.id = l.tag_id
  WHERE l.target_type = 'tag' AND l.target_id = ? ORDER BY s.path`, oldTarget?.id ?? -1);
// 演示脚本遗留的 tag 型边(不属于本任务的旧边,列出以免误删)
const demoEdges = q(`SELECT l.tag_id, l.target_id, l.remark, s.path autor, t.path tgt
  FROM tag_links l JOIN tags s ON s.id = l.tag_id JOIN tags t ON t.id = l.target_id
  WHERE l.target_type = 'tag' AND l.target_id != ? AND s.path LIKE '作者/%' ORDER BY s.path`, oldTarget?.id ?? -1);

console.log(`库: ${dbPath}${APPLY ? '  [--apply 会真写]' : '  [dry-run 不写库]'}`);
console.log(`tag_plain 自检通过(${cases.length} 条共享向量)`);
console.log(`旧边(${OLD_TARGET})共 ${oldEdges.length} 条,涉及作者 ${oldEdges.length} 位\n`);

// ---------- 推断 ----------
const rows = []; // { autor, autorId, notes, nationNotes: Map<nation,Set<noteId>> }
for (const e of oldEdges) {
  const notes = noteIdsOf(e.tag_id);
  const nationNotes = new Map();
  for (const n of notes) {
    for (const p of placePathsOf(n)) {
      const nation = normalizeNation(nationOf(p));
      if (!nationNotes.has(nation)) nationNotes.set(nation, new Set());
      nationNotes.get(nation).add(n);
    }
  }
  const ranked = [...nationNotes].map(([nation, set]) => ({ nation, ids: [...set].sort((a, b) => a - b) }))
    .sort((a, b) => b.ids.length - a.ids.length || a.nation.localeCompare(b.nation));
  rows.push({ autor: e.autor, autorId: e.tag_id, notes, ranked });
}
const inferable = rows.filter((r) => r.ranked.length === 1);
const multi = rows.filter((r) => r.ranked.length > 1);
const unknown = rows.filter((r) => r.ranked.length === 0);
// 要写的国籍标签必须真实存在(中国 -> 中国大陆 是映射,先验,免得后面 tagOf(...).id 抛错)
const missingNations = [...new Set(rows.flatMap((r) => r.ranked.map((x) => x.nation)))].filter((p) => tagOf(p) === undefined);
if (missingNations.length > 0) {
  console.error(`库里不存在这些国籍标签,拒绝执行: ${missingNations.join(', ')}`);
  process.exit(3);
}

// ---------- 打印(给用户看的表) ----------
const dw = (s) => [...s].reduce((n, c) => n + (/[\u1100-\uFFE6]/.test(c) ? 2 : 1), 0);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - dw(s)));
const COL = [26, 24, 34, 12];
const rule = (ch = '-') => COL.map((w) => ch.repeat(w)).join('+');
console.log('表 1:作者 -> 建议国籍边');
console.log([pad('作者标签', COL[0]), pad('建议值(属性名=国籍)', COL[1]), pad('证据(笔记数/笔记id)', COL[2]), pad('是否多值', COL[3])].join('|'));
console.log(rule());
for (const r of rows) {
  const label = r.ranked.length === 0
    ? '(无法推断)'
    : r.ranked.map((x) => `${x.nation}${SUSPECT.has(x.nation) ? '(存疑)' : ''}`).join(' , ');
  const ev = r.ranked.length === 0
    ? (r.notes.length === 0 ? '名下无笔记' : `${r.notes.length} 条笔记,无国家级地点`)
    : r.ranked.map((x) => `${x.ids.length} 条 (${x.ids.map((i) => '#' + i).join(',')})`).join(' ; ');
  const many = r.ranked.length > 1 ? `多值(${r.ranked.length}),需你选` : (r.ranked.length === 1 ? '否' : '-');
  console.log([pad(r.autor, COL[0]), pad(label, COL[1]), pad(ev, COL[2]), pad(many, COL[3])].join('|'));
}
console.log(rule('='));

console.log('\n表 2:证据明细(笔记标题 + 该笔记命中的国家级地点)');
for (const r of rows) {
  const per = r.ranked.map((x) => `${x.nation}[${x.ids.map((i) => `#${i} ${noteTitle(i)}`).join(' / ')}]`).join(' ');
  console.log(`  ${r.autor}(id=${r.autorId}) 笔记 ${r.notes.length} 条 -> ${per || '(无)'}`);
}

console.log(`\n无法推断清单(${unknown.length} 位):`);
if (unknown.length === 0) console.log('  (无)');
for (const r of unknown) console.log(`  ${r.autor}(id=${r.autorId}) 名下笔记 ${r.notes.length} 条 —— ${r.notes.length === 0 ? '无笔记' : '笔记上无国家级地点标签'}`);
console.log(`多值清单(${multi.length} 位):`);
if (multi.length === 0) console.log('  (无)');
for (const r of multi) console.log(`  ${r.autor}(id=${r.autorId}) -> ${r.ranked.map((x) => `${x.nation}(${x.ids.length} 条)`).join(' / ')}`);

// ---------- 旧边处理方案(只规划,不执行) ----------
const hasEdge = (from, to) => db.prepare(
  "SELECT 1 FROM tag_links WHERE tag_id = ? AND target_type = 'tag' AND target_id = ?").get(from, to) !== undefined;
const addPlan = inferable.map((r) => ({ autor: r.autor, from: r.autorId, to: tagOf(r.ranked[0].nation).id, nation: r.ranked[0].nation }));
const already = addPlan.filter((p) => hasEdge(p.from, p.to));
console.log('\n旧边处理方案(本段只是规划,dry-run 不执行):');
console.log(`  会删:${oldEdges.length} 行 —— 对每条旧边按主键 (tag_id,'tag',${oldTarget?.id ?? '?'}) 精确删除,只删这些旧边,不动别的 tag 型边`);
console.log(`  会加:${addPlan.length} 行 —— 唯一值作者各写一条 (${addPlan.map((p) => p.from).join(',')}) x 'tag' x 国家,remark='${ATTR}'`);
console.log(`    其中主键已存在 ${already.length} 行(demo 遗留,INSERT OR IGNORE 跳过)-> 实际新增 ${addPlan.length - already.length} 行`);
for (const p of already) console.log(`      [已存在] ${p.autor} --(${ATTR})--> ${p.nation}`);
const otherDemos = demoEdges.filter((d) => !addPlan.some((p) => p.from === d.tag_id && p.to === d.target_id));
console.log(`  待定:${multi.length} 位多值作者本轮不写(需你选定后再加 ${multi.length} 行)`);
console.log(`  无法推断:${unknown.length} 位,不写(旧边删除后其国籍关系为空)`);
if (otherDemos.length > 0) {
  console.log(`  另:库里还有 ${otherDemos.length} 条演示脚本遗留的 tag 型边,不属于本任务,不动:`);
  for (const d of otherDemos) console.log(`    ${d.autor} --(${d.remark})--> ${d.tgt}`);
}

if (!APPLY) {
  console.log('\ndry-run 结束。确认以上读数后再对库副本 --apply,最后才对真库执行。');
  process.exit(0);
}

// ---------- 执行 ----------
const before = { links: db.prepare('SELECT COUNT(*) c FROM tag_links').get().c };
const backup = dbPath.replace(/\.db$/, '--pre-author-nation-backup.db');
// 库是 WAL 模式,copyFileSync 只拷 .db 会丢掉 -wal 里的最新事务 -> 用 VACUUM INTO 生成单文件快照(等价全量备份)
if (existsSync(backup)) rmSync(backup);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log('\n已备份(VACUUM INTO):', backup);
db.exec('BEGIN');
try {
  const del = db.prepare("DELETE FROM tag_links WHERE tag_id = ? AND target_type = 'tag' AND target_id = ?");
  for (const e of oldEdges) del.run(e.tag_id, e.target_id);
  const ins = db.prepare("INSERT OR IGNORE INTO tag_links (tag_id, target_type, target_id, remark) VALUES (?, 'tag', ?, ?)");
  for (const p of addPlan) ins.run(p.from, p.to, ATTR);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('失败已回滚:', err.message);
  process.exit(1);
}
const after = { links: db.prepare('SELECT COUNT(*) c FROM tag_links').get().c };
console.log('完成。对账:');
console.log(`  链接 ${before.links} -> ${after.links}(应 = 原 - ${oldEdges.length} + ${addPlan.length - already.length})`);
console.log(`  旧边残留:${q("SELECT COUNT(*) c FROM tag_links WHERE target_type='tag' AND target_id = ?", oldTarget.id)[0].c}(应 0)`);
console.log('  完整性:', db.prepare('PRAGMA integrity_check').get());

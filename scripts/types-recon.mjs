// 标签类型收口**夹具对账**(不是产品等价性证据):同一份数据分别以「旧模型(roles/tag_roles)」
// 与「新模型(tags.is_type + tag_links 'type' 行)」表达,跑两侧谓词,断言筛「类型:国籍」
// 的笔记 id 集合逐值相同。另在真实库副本上做一次改前/改后对账(真实库只读)。
//
// 注意:本脚本**不 import 任何产品代码**,两侧谓词是在 JS 里手抄的一份;它只能证明
// 「手上这套夹具用两种模型表达时结果一致」,对 src-tauri/src/db/repos/filter_predicates.rs
// 做变异不会改变它的输出 —— 因此它不能作为「产品行为等价」的证据。真正有判别力的等价性用例
// 是 Rust 测试 notes_query_type_tests::large_type_set_matches_brute_force(在真实谓词实现上
// 跑暴力枚举比对)。要验产品等价性请跑 cargo test,不要引用本脚本的输出。
// 用法:node scripts/types-recon.mjs
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REAL_DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';

/** 谓词共用的 EXISTS 外壳:笔记 n 挂着满足 m 的标签 */
const exists = (m) =>
  `EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id ` +
  `WHERE l.target_type = 'note' AND l.target_id = n.id AND (${m}))`;

/** 携带继承侧(新旧一致):t 落在某个携带 path 的标签子树内 */
const carry = `t.id IN (SELECT d.id FROM tags d
  JOIN tag_links cl ON cl.target_type = 'tag'
  JOIN tags ca ON ca.id = cl.tag_id
  WHERE cl.target_id IN (SELECT id FROM tags WHERE path = ?)
    AND (d.path = ca.path OR substr(d.path, 1, length(ca.path) + 1) = ca.path || '/'))`;

/** 旧模型:认领侧读 roles / tag_roles */
const OLD = `(t.id IN (SELECT d.id FROM tags d
    JOIN tags c ON (d.path = c.path OR substr(d.path, 1, length(c.path) + 1) = c.path || '/')
    JOIN tag_roles tr ON tr.tag_id = c.id
    JOIN roles r ON r.id = tr.role_id
    JOIN tags rt ON rt.id = r.tag_id
    WHERE rt.path = ?)) OR ${carry}`;

/** 新模型:认领侧读 tags.is_type + tag_links 的 'type' 行 */
const NEW = `(t.id IN (SELECT d.id FROM tags d
    JOIN tags c ON (d.path = c.path OR substr(d.path, 1, length(c.path) + 1) = c.path || '/')
    JOIN tag_links tl ON tl.target_type = 'type' AND tl.tag_id = c.id
    JOIN tags rt ON rt.id = tl.target_id
    WHERE rt.path = ?)) OR ${carry}`;

const hitIds = (db, pred, path) =>
  db
    .prepare(`SELECT n.id FROM notes n WHERE ${exists(pred)} ORDER BY n.id`)
    // 两个 `?`:认领侧按类型路径、携带侧也按类型路径
    .all(path, path)
    .map((r) => r.id);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 夹具:国籍/所在两个类型标签,中国(含子级)认领国籍,上海认领所在,作者A 携带国籍 */
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE notes(id INTEGER PRIMARY KEY);
    CREATE TABLE tags(id INTEGER PRIMARY KEY, path TEXT, is_type INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE roles(id INTEGER PRIMARY KEY, tag_id INTEGER);
    CREATE TABLE tag_roles(tag_id INTEGER, role_id INTEGER);
    CREATE TABLE tag_links(tag_id INTEGER, target_type TEXT, target_id INTEGER);
  `);
  for (let i = 1; i <= 6; i++) db.prepare('INSERT INTO notes(id) VALUES(?)').run(i);
  const tag = (id, path) => db.prepare('INSERT INTO tags(id, path) VALUES(?, ?)').run(id, path);
  ['国籍', '中国', '中国/北京', '所在', '上海', '作者A'].forEach((p, i) => tag(i + 1, p));
  const notes = db.prepare("INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?, 'note', ?)");
  notes.run(2, 1); notes.run(3, 2); notes.run(5, 3); notes.run(6, 4); notes.run(6, 5);
  db.prepare("INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(6, 'tag', 1)").run();
  // 旧模型认领
  db.prepare('INSERT INTO roles(id, tag_id) VALUES(1, 1)').run();
  db.prepare('INSERT INTO roles(id, tag_id) VALUES(2, 4)').run();
  db.prepare('INSERT INTO tag_roles(tag_id, role_id) VALUES(2, 1)').run();
  db.prepare('INSERT INTO tag_roles(tag_id, role_id) VALUES(5, 2)').run();
  return db;
}

/** 把夹具从旧模型搬到新模型:is_type 标在国籍/所在上,认领改写成 'type' 行 */
function migrateFixture(old) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE notes(id INTEGER PRIMARY KEY);
    CREATE TABLE tags(id INTEGER PRIMARY KEY, path TEXT, is_type INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE tag_links(tag_id INTEGER, target_type TEXT, target_id INTEGER);
  `);
  for (const n of old.prepare('SELECT id FROM notes').all())
    db.prepare('INSERT INTO notes(id) VALUES(?)').run(n.id);
  for (const t of old.prepare('SELECT id, path FROM tags').all())
    db.prepare('INSERT INTO tags(id, path) VALUES(?, ?)').run(t.id, t.path);
  for (const l of old.prepare('SELECT tag_id, target_type, target_id FROM tag_links').all())
    db.prepare('INSERT INTO tag_links VALUES(?, ?, ?)').run(l.tag_id, l.target_type, l.target_id);
  for (const r of old.prepare('SELECT tag_id FROM roles').all())
    db.prepare('UPDATE tags SET is_type = 1 WHERE id = ?').run(r.tag_id);
  for (const tr of old
    .prepare('SELECT tr.tag_id, r.tag_id AS type_id FROM tag_roles tr JOIN roles r ON r.id = tr.role_id')
    .all())
    db.prepare("INSERT INTO tag_links VALUES(?, 'type', ?)").run(tr.tag_id, tr.type_id);
  return db;
}

const oldDb = fixture();
const newDb = migrateFixture(oldDb);
console.log(
  '[说明] 本脚本是夹具对账,不 import 产品代码;产品等价性以 Rust 用例 ' +
    'notes_query_type_tests::large_type_set_matches_brute_force 为准。'
);
let ok = true;
for (const [path, why] of [['国籍', '认领(含子级)∪携带'], ['所在', '只认领'], ['作者A', '只携带']]) {
  const a = hitIds(oldDb, OLD, path);
  const b = hitIds(newDb, NEW, path);
  const pass = same(a, b);
  ok = ok && pass;
  console.log(`[夹具] 类型:${path}(${why})  旧=${JSON.stringify(a)}  新=${JSON.stringify(b)}  ${pass ? '一致' : '不一致'}`);
}
console.log(`[夹具] 结论:${ok ? '两侧命中集逐值相同' : '存在差异'}`);

// --- 真实库副本上的改前/改后对账(真实库只读;只操作副本) ---
let realLine = '真实库不存在,跳过';
if (existsSync(REAL_DB)) {
  const dir = mkdtempSync(join(tmpdir(), 'lifelog-recon-'));
  const before = join(dir, 'before.db');
  const after = join(dir, 'after.db');
  copyFileSync(REAL_DB, before);
  copyFileSync(REAL_DB, after);
  const b = new DatabaseSync(before);
  const a = new DatabaseSync(after);
  const hasTable = (db, name) =>
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(name).n > 0;
  const hasIsType = (db) =>
    db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('tags') WHERE name='is_type'").get().n > 0;
  if (!hasTable(b, 'roles') || !hasTable(b, 'tag_roles')) {
    // 库已被应用升到 021(旧表已删):没有旧模型可对照,不能假称“旧/新一致”
    realLine = '真实库副本已是新模型(roles/tag_roles 已删),无从做旧/新对账,跳过';
  } else {
    // 改后副本模拟迁移 021(旧表存在时才有这一路)
    if (!hasIsType(a)) a.exec('ALTER TABLE tags ADD COLUMN is_type INTEGER NOT NULL DEFAULT 0');
    a.exec('DROP TABLE IF EXISTS tag_roles');
    a.exec('DROP TABLE IF EXISTS roles');
    const beforeHits = hitIds(b, OLD, '地点轴/国籍');
    const afterHits = hitIds(a, NEW, '地点轴/国籍');
    realLine =
      `真实库副本 类型:地点轴/国籍  旧(${beforeHits.length} 条) 新(${afterHits.length} 条)  ` +
      `${same(beforeHits, afterHits) ? '逐值相同' : '不一致'}`;
  }
  b.close();
  a.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`[真实库] ${realLine}`);
console.log(
  `[说明] 以上读数只对账夹具/副本;产品行为等价性证据在 Rust 用例 ` +
    `notes_query_type_tests::large_type_set_matches_brute_force(cargo test)。`
);

if (!ok) process.exit(1);

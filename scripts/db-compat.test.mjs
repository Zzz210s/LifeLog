// db-compat.mjs 的兼容视图契约。两层数据同源:
//   v30 夹具:老真表 `entities`/`edges`(028 后的形状);
//   v31 夹具:`points`/`lines`(031 后)+ 保留点 `子级`(id 0)+ 关系名点,
//   老名 `entities`/`edges`/`entities_fts`/`entities_fts_src` 全靠 TEMP 别名视图还原。
// 两套夹具的**逻辑数据相同**,故同一组 `sharedLegacyReads` 必须在两边读出逐值相同的结果。
// 跑法:node --test scripts/db-compat.test.mjs(不在 pnpm test 的 vitest include 里,手动跑)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openReadOnly } from './db-compat.mjs';

/** v30 形状:1 条笔记间链接 + 1 条树边 + 1 条标签间引用 + 2 个标签 + 别名 + 合并日志 */
const buildV30 = (db) => db.exec(`
  CREATE TABLE entities (id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, color TEXT, parent_id INTEGER, path TEXT, depth INTEGER, sort_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE edges (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
    kind TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE entity_aliases (alias TEXT PRIMARY KEY, entity_id INTEGER NOT NULL);
  CREATE TABLE entity_merge_log (id INTEGER PRIMARY KEY, source_entity_id INTEGER NOT NULL, target_entity_id INTEGER NOT NULL,
    moved_child_ids TEXT NOT NULL DEFAULT '[]', note_links INTEGER NOT NULL DEFAULT 0, edges INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL DEFAULT '', meta_snapshot TEXT NOT NULL DEFAULT '');
  CREATE VIRTUAL TABLE entities_fts USING fts5(meta, paths, tokenize='trigram');
  CREATE VIEW entities_fts_src(id, meta, paths) AS SELECT id, meta, COALESCE(path, '') FROM entities;
  INSERT INTO entities(id,meta,created_at,path,depth,parent_id) VALUES
    (1,'买牛奶','2026-01-01',NULL,NULL,NULL),
    (2,'目标条目','2026-01-01',NULL,NULL,NULL),
    (100,'书籍','2026-01-01','书籍',1,NULL),
    (101,'SQL','2026-01-01','书籍/SQL',2,100);
  INSERT INTO edges(id,source_id,target_id,kind,remark,created_at) VALUES
    (10,1,100,'link','',            '2026-01-01'),  -- 老 tagging:笔记 -> 标签
    (11,100,101,'child','',         '2026-01-01'),  -- 树边(不算引用)
    (12,101,100,'link','上位概念','2026-01-01'),   -- 老 relation:标签 -> 标签
    (13,1,2,'link','',              '2026-01-01');  -- 老 note_links:笔记 -> 笔记
  INSERT INTO entity_aliases(alias,entity_id) VALUES('书',100);
  INSERT INTO entity_merge_log(id,source_entity_id,target_entity_id,note_links,edges,at) VALUES
    (1,101,100,1,2,'2026-01-01'),
    (2,1000000101,1000000100,3,4,'2026-01-02');
  INSERT INTO entities_fts(rowid,meta,paths) VALUES
    (1,'买牛奶','书籍/SQL 书籍'),(2,'目标条目',''),(100,'书籍','书籍'),(101,'SQL','书籍');
`);

/** v31 形状:同源数据 —— 点 0=`子级`、点 200=关系名点「上位概念」;线用 name_id 承载名字(NULL/0/名字点) */
const buildV31 = (db) => db.exec(`
  CREATE TABLE points (id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, color TEXT,
    parent_id INTEGER, path TEXT, depth INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
    is_cited INTEGER NOT NULL DEFAULT 0 CHECK (is_cited IN (0, 1)));
  CREATE TABLE lines (id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, name_id INTEGER,
    created_at TEXT NOT NULL, CHECK (from_id <> to_id));
  CREATE TABLE entity_aliases (alias TEXT PRIMARY KEY, entity_id INTEGER NOT NULL);
  CREATE TABLE entity_merge_log (id INTEGER PRIMARY KEY, source_entity_id INTEGER NOT NULL, target_entity_id INTEGER NOT NULL,
    moved_child_ids TEXT NOT NULL DEFAULT '[]', note_links INTEGER NOT NULL DEFAULT 0, edges INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL DEFAULT '', meta_snapshot TEXT NOT NULL DEFAULT '');
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE VIRTUAL TABLE points_fts USING fts5(meta, paths, tokenize='trigram');
  CREATE VIEW points_fts_src(id, meta, paths) AS
    SELECT id, meta, COALESCE(path, '') FROM points WHERE id NOT IN (0, 200);
  INSERT INTO settings(key,value) VALUES('tree_line_name_id','0');
  INSERT INTO points(id,meta,created_at,path,depth,parent_id,is_cited) VALUES
    (0,'子级','2026-01-01',NULL,NULL,NULL,0),
    (1,'买牛奶','2026-01-01',NULL,NULL,NULL,1),
    (2,'目标条目','2026-01-01',NULL,NULL,NULL,1),
    (100,'书籍','2026-01-01','书籍',1,NULL,1),
    (101,'SQL','2026-01-01','书籍/SQL',2,100,0),
    (200,'上位概念','2026-01-01',NULL,NULL,NULL,0);
  INSERT INTO lines(id,from_id,to_id,name_id,created_at) VALUES
    (10,1,100,NULL,'2026-01-01'),  -- 无名字线 = 老 tagging
    (11,100,101,0,   '2026-01-01'),  -- name_id=0 -> 老 child
    (12,101,100,200, '2026-01-01'),  -- 名字点「上位概念」-> 老 relation
    (13,1,2,NULL,    '2026-01-01');  -- 无名字线 = 老 note_links
  INSERT INTO entity_aliases(alias,entity_id) VALUES('书',100);
  INSERT INTO entity_merge_log(id,source_entity_id,target_entity_id,note_links,edges,at) VALUES
    (1,101,100,1,2,'2026-01-01'),
    (2,1000000101,1000000100,3,4,'2026-01-02');
  INSERT INTO points_fts(rowid,meta,paths) VALUES
    (1,'买牛奶','书籍/SQL 书籍'),(2,'目标条目',''),(100,'书籍','书籍'),(101,'SQL','书籍');
`);

const withFixture = (build, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'lifelog-dbcompat-'));
  const file = join(dir, 'lifelog.db');
  const db = new DatabaseSync(file);
  build(db);
  db.close();
  try {
    fn(file);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄晚释放 */ }
  }
};

/** 两套夹具都必须读出的同一组结果(老老名视图 + v31 回译列) */
function sharedLegacyReads(db) {
  const n = (sql) => db.prepare(sql).get().n;
  const rows = (sql) => db.prepare(sql).all().map((r) => ({ ...r })); // sqlite 行是 null 原型对象
  assert.equal(n('SELECT COUNT(*) n FROM tags'), 2);
  assert.equal(db.prepare('SELECT content FROM notes WHERE id=1').get().content, '买牛奶');
  assert.deepEqual(rows('SELECT id,name FROM tags ORDER BY id'),
    [{ id: 100, name: '书籍' }, { id: 101, name: 'SQL' }]);
  assert.deepEqual(rows('SELECT tag_id,target_type,target_id,remark FROM tag_links ORDER BY target_type, tag_id'),
    [{ tag_id: 100, target_type: 'note', target_id: 1, remark: '' },
     { tag_id: 101, target_type: 'tag', target_id: 100, remark: '上位概念' }]);
  assert.deepEqual(rows('SELECT id,source_id,target_id,raw_title FROM note_links'),
    [{ id: 13, source_id: 1, target_id: 2, raw_title: '' }]);
  assert.deepEqual(rows('SELECT rowid,name,content,tags FROM notes_fts ORDER BY rowid'),
    [{ rowid: 1, name: '', content: '买牛奶', tags: '书籍/SQL 书籍' },
     { rowid: 2, name: '', content: '目标条目', tags: '' }]);
  assert.deepEqual(rows('SELECT alias,tag_id FROM tag_aliases'), [{ alias: '书', tag_id: 100 }]);
  assert.deepEqual(rows('SELECT id,source_tag_id,target_tag_id FROM tag_merge_log ORDER BY id'),
    [{ id: 1, source_tag_id: 101, target_tag_id: 100 },
     { id: 2, source_tag_id: 101, target_tag_id: 100 }]); // 1e9 偏移行回译
  // v31 回译列:kind 由 name_id=0 判子级,remark 由名字点 meta 取文本
  assert.deepEqual(rows('SELECT kind,remark,COUNT(*) n FROM edges GROUP BY 1,2 ORDER BY 1,2'),
    [{ kind: 'child', remark: '', n: 1 },
     { kind: 'link', remark: '', n: 2 },
     { kind: 'link', remark: '上位概念', n: 1 }]);
  assert.equal(n('SELECT COUNT(*) n FROM entities WHERE parent_id IS NOT NULL'), 1);
  assert.equal(n('SELECT COUNT(*) n FROM entities_fts'), 4);
  assert.equal(n('SELECT COUNT(*) n FROM entities_fts_src'), 4);
  return { n, rows };
}

test('v30 真表:老表名视图还原等价数据', () => {
  withFixture(buildV30, (file) => {
    const db = openReadOnly(file);
    try {
      const { n } = sharedLegacyReads(db);
      assert.equal(n('SELECT COUNT(*) n FROM notes'), 2);
      assert.equal(n('SELECT COUNT(*) n FROM entities'), 4);
      assert.deepEqual(Object.keys(db.prepare('SELECT * FROM entities LIMIT 1').get()),
        ['id', 'meta', 'is_cited', 'created_at', 'color', 'parent_id', 'path', 'depth', 'sort_order']);
      assert.deepEqual(Object.keys(db.prepare('SELECT * FROM edges LIMIT 1').get()),
        ['id', 'source_id', 'target_id', 'kind', 'remark', 'created_at']);
    } finally { db.close(); }
  });
});

test('v31 改名别名:老名视图读数与 v30 逐值相同', () => {
  withFixture(buildV31, (file) => {
    const db = openReadOnly(file);
    try {
      const { n } = sharedLegacyReads(db);
      // 别名直通新表:点数 6(含保留点 `子级` 与关系名点),列序与 v30 `entities` 一字不差
      assert.equal(n('SELECT COUNT(*) n FROM points'), 6);
      assert.equal(n('SELECT COUNT(*) n FROM lines'), 4);
      assert.equal(n('SELECT COUNT(*) n FROM entities'), 6);
      // 纯名字点 path IS NULL,老 `notes` 视图会多读 2 行(直通口径的已知差值,见 T1.1 验收)
      assert.equal(n('SELECT COUNT(*) n FROM notes'), 4);
      assert.deepEqual(Object.keys(db.prepare('SELECT * FROM entities LIMIT 1').get()),
        ['id', 'meta', 'is_cited', 'created_at', 'color', 'parent_id', 'path', 'depth', 'sort_order']);
      assert.deepEqual(Object.keys(db.prepare('SELECT * FROM edges LIMIT 1').get()),
        ['id', 'source_id', 'target_id', 'kind', 'remark', 'created_at']);
    } finally { db.close(); }
  });
});

test('compat_edges_kind_child_from_name_id_zero', () => {
  withFixture(buildV31, (file) => {
    const db = openReadOnly(file);
    try {
      assert.equal(db.prepare('SELECT kind FROM edges WHERE id=11').get().kind, 'child'); // name_id = 0
      assert.deepEqual({ ...db.prepare('SELECT kind,remark FROM edges WHERE id=12').get() },
        { kind: 'link', remark: '上位概念' });
    } finally { db.close(); }
  });
});

test('compat_edges_remark_defaults_to_empty_string', () => {
  withFixture(buildV31, (file) => {
    const db = openReadOnly(file);
    try {
      const r = db.prepare('SELECT remark FROM edges WHERE id=10').get(); // name_id IS NULL
      assert.equal(r.remark, '');
      assert.notEqual(r.remark, null);
    } finally { db.close(); }
  });
});

test('v31 下写 edges 给出明确中文提示(只读脚本不应写)', () => {
  withFixture(buildV31, (file) => {
    const db = openReadOnly(file);
    try {
      assert.throws(() => db.exec("UPDATE edges SET remark='x'"), /已无 edges 表/);
    } finally { db.close(); }
  });
});

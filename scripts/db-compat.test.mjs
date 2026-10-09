// db-compat.mjs 的兼容视图契约(迁移 028/029 后:实体二分由 `path` 表达,`meta`/`paths` 改名)。
// 老验收脚本按老表名/老列名读数,本件用一个最小 v29 形状的临时库把「等价数据」钉住。
// 跑法:node --test scripts/db-compat.test.mjs(不在 pnpm test 的 vitest include 里,手动跑)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openReadOnly } from './db-compat.mjs';

/** 最小 v29 形状:1 条笔记 + 1 条笔记间链接 + 2 个标签 + 1 条标签间引用 + 别名 + 合并日志 */
function build() {
  const dir = mkdtempSync(join(tmpdir(), 'lifelog-dbcompat-'));
  const file = join(dir, 'lifelog.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE entities (id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, color TEXT, parent_id INTEGER, path TEXT, depth INTEGER, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE edges (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
      kind TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE entity_aliases (alias TEXT PRIMARY KEY, entity_id INTEGER NOT NULL);
    CREATE TABLE entity_merge_log (id INTEGER PRIMARY KEY, source_entity_id INTEGER NOT NULL, target_entity_id INTEGER NOT NULL,
      moved_child_ids TEXT NOT NULL DEFAULT '[]', note_links INTEGER NOT NULL DEFAULT 0, edges INTEGER NOT NULL DEFAULT 0,
      at TEXT NOT NULL DEFAULT '', meta_snapshot TEXT NOT NULL DEFAULT '');
    CREATE VIRTUAL TABLE entities_fts USING fts5(meta, paths, tokenize='trigram');
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
    INSERT INTO entities_fts(rowid,meta,paths) VALUES(1,'买牛奶','书籍/SQL 书籍'),(100,'书籍','书籍');
  `);
  db.close();
  return { dir, file };
}

test('老表名视图在新 schema 上还原等价数据', () => {
  const { dir, file } = build();
  try {
    const db = openReadOnly(file);
    const n = (sql) => db.prepare(sql).get().n;
    // sqlite 行是 null 原型对象,比对前摊成普通对象
    const rows = (sql) => db.prepare(sql).all().map((r) => ({ ...r }));
    // 实体二分 = path:notes = 树外(老笔记),tags = 树内(老标签)
    assert.equal(n('SELECT COUNT(*) n FROM notes'), 2);
    assert.equal(n('SELECT COUNT(*) n FROM tags'), 2);
    // notes.content = meta
    assert.equal(db.prepare('SELECT content FROM notes WHERE id=1').get().content, '买牛奶');
    // tags.name = path 末段(多段路由 substr 取末段,单段路兜底为整串)
    assert.deepEqual(
      rows('SELECT id,name FROM tags ORDER BY id'),
      [{ id: 100, name: '书籍' }, { id: 101, name: 'SQL' }]
    );
    // tag_links:笔记->标签 记 target_type='note'(tag_id=标签),标签->标签 记 'tag'(tag_id=源);child 边不算
    assert.deepEqual(
      rows('SELECT tag_id,target_type,target_id,remark FROM tag_links ORDER BY target_type, tag_id'),
      [
        { tag_id: 100, target_type: 'note', target_id: 1, remark: '' },
        { tag_id: 101, target_type: 'tag', target_id: 100, remark: '上位概念' },
      ]
    );
    // note_links 只含两端都是树外实体的 link 边;raw_title 老表才有 -> 空串
    assert.deepEqual(
      rows('SELECT id,source_id,target_id,raw_title FROM note_links'),
      [{ id: 13, source_id: 1, target_id: 2, raw_title: '' }]
    );
    // notes_fts 只投影树外实体行,tags 列 = 新列 paths
    assert.deepEqual(
      rows('SELECT rowid,name,content,tags FROM notes_fts ORDER BY rowid'),
      [{ rowid: 1, name: '', content: '买牛奶', tags: '书籍/SQL 书籍' }]
    );
    assert.deepEqual(rows('SELECT alias,tag_id FROM tag_aliases'), [{ alias: '书', tag_id: 100 }]);
    // tag_merge_log:新号行原样;027 前遗留的 1e9 偏移行回译成老表原始 id(101/100)
    assert.equal(n('SELECT COUNT(*) n FROM tag_merge_log'), 2);
    assert.deepEqual(
      rows('SELECT id,source_tag_id,target_tag_id FROM tag_merge_log ORDER BY id'),
      [
        { id: 1, source_tag_id: 101, target_tag_id: 100 },
        { id: 2, source_tag_id: 101, target_tag_id: 100 },
      ]
    );
    db.close();
  } finally {
    // Windows 下 sqlite 句柄可能晚一步释放,清理失败不影响断言(用后即弃的临时目录)
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

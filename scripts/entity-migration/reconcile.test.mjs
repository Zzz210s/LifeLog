/** T1.0 对账脚本测试：七条不变量（v28 全绿 / v27 整组 N/A / 反例 / 变异自证）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseBlocks, runReconcile, formatReport } from './reconcile-lib.mjs';

const SQL = fileURLToPath(new URL('./reconcile.sql', import.meta.url));

const V27_SCHEMA = `
CREATE TABLE entities(id INTEGER PRIMARY KEY, kind TEXT, name TEXT, content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '', color TEXT, parent_id INTEGER, path TEXT, depth INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edges(id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
  kind TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
  UNIQUE(source_id, kind, target_id));
CREATE VIRTUAL TABLE entities_fts USING fts5(meta);`;

const V28_SCHEMA = `
CREATE TABLE entities(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '', parent_id INTEGER, path TEXT, depth INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edges(id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
  kind TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
  UNIQUE(source_id, kind, target_id));
CREATE TABLE entity_merge_log(id INTEGER PRIMARY KEY, source_entity_id INTEGER, target_entity_id INTEGER);
CREATE VIRTUAL TABLE entities_fts USING fts5(meta);`;

function open(dir, name, schema) {
  const db = new DatabaseSync(join(dir, name));
  db.exec(schema);
  return db;
}

function buildV27(dir) {
  const db = open(dir, 'v27.db', V27_SCHEMA);
  db.exec(`INSERT INTO entities(id,kind,name,parent_id,path,depth) VALUES
    (1,'tag','工作',NULL,'工作',1),(2,'tag','项目',1,'工作/项目',2),(3,'note','',NULL,NULL,NULL)`);
  db.exec(`INSERT INTO edges(id,source_id,target_id,kind) VALUES (1,1,2,'child'),(2,3,2,'tagging')`);
  db.exec(`INSERT INTO entities_fts(rowid,meta) VALUES (1,'工作'),(2,'项目'),(3,'第一篇')`);
  db.exec('PRAGMA user_version=27');
  db.close();
  return join(dir, 'v27.db');
}

function buildV28(dir) {
  const db = open(dir, 'v28.db', V28_SCHEMA);
  db.exec(`INSERT INTO entities(id,meta,is_cited,parent_id,path,depth) VALUES
    (1,'工作',0,NULL,'工作',1),(2,'项目',1,1,'工作/项目',2),(3,'第一篇'||char(10)||'正文',0,NULL,NULL,NULL)`);
  db.exec(`INSERT INTO edges(id,source_id,target_id,kind) VALUES (1,1,2,'child'),(2,3,2,'link')`);
  db.exec(`INSERT INTO entities_fts(rowid,meta) VALUES (1,'工作'),(2,'项目'),(3,'第一篇')`);
  db.exec('PRAGMA user_version=28');
  db.close();
  return join(dir, 'v28.db');
}

const check = (report, n) => report.checks.find((c) => c.n === String(n));
const SEVEN = ['1', '2', '3', '4', '5', '6', '7'];

test('reconcile.sql：只有 modern 七条，无 legacy 块', () => {
  const blocks = parseBlocks(readFileSync(SQL, 'utf8'));
  assert.ok(blocks.every((b) => b.mode !== 'legacy'), '不应再有 legacy 块');
  assert.ok(blocks.some((b) => b.kind === 'count' && b.key === 'entities'));
  for (const n of SEVEN) assert.ok(blocks.some((b) => b.kind === 'check' && b.n === n), `缺第 ${n} 条`);
});

test('v27 库：七条整组 N/A（缺 meta/is_cited），实体/边读数仍在', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-v27-'));
  try {
    const report = runReconcile({ dbPath: buildV27(dir), sqlPath: SQL });
    assert.equal(report.user_version, 27);
    assert.equal(report.counts.entities, 3);
    assert.equal(report.counts.edges, 2);
    assert.equal(report.counts.entities_path_nonnull, 2);
    assert.equal(report.counts.is_cited, 'N/A');
    for (const n of SEVEN) {
      const c = check(report, n);
      assert.equal(c.status, 'N/A', `v27 第 ${n} 条应为 N/A: ${JSON.stringify(c)}`);
    }
    assert.equal(check(report, 'integrity').status, 'PASS');
    assert.equal(check(report, 'fk').status, 'PASS');
    assert.match(formatReport(report), /user_version=27/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v28 库：七条全 0 行 + 稳定读数逐值', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-v28-'));
  try {
    const report = runReconcile({ dbPath: buildV28(dir), sqlPath: SQL });
    for (const n of SEVEN) {
      const c = check(report, n);
      assert.equal(c.status, 'PASS', `v28 第 ${n} 条: ${JSON.stringify(c.rows)}`);
    }
    assert.deepEqual(
      ['entities', 'entities_min_id', 'entities_max_id', 'entities_distinct_id', 'entities_path_nonnull',
        'entities_path_null', 'edges', 'entities_fts', 'is_cited', 'edges_child', 'edges_link',
        'link_remark_nonnull', 'tree_closure', 'feed_default', 'sibling_key_out_of_scope', 'id_gaps']
        .map((k) => report.counts[k]),
      [3, 1, 3, 3, 2, 1, 2, 3, 1, 1, 1, 0, 2, 1, 0, 0],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('反例：is_cited 与 link 入边不符 -> 第 1 条 FAIL 1 行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-c1-'));
  try {
    const dbPath = buildV28(dir);
    const db = new DatabaseSync(dbPath);
    db.exec('UPDATE entities SET is_cited=1 WHERE id=1');
    db.close();
    const c = check(runReconcile({ dbPath, sqlPath: SQL }), '1');
    assert.equal(c.status, 'FAIL');
    assert.equal(c.rowCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('反例：重复 child 入边 -> 第 5 条 FAIL；无合并记录的库 id 断号 -> 第 7 条 FAIL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-c57-'));
  try {
    const dbPath = buildV28(dir);
    const db = new DatabaseSync(dbPath);
    db.exec(`INSERT INTO edges(source_id,target_id,kind) VALUES (3,2,'child')`);
    db.exec(`INSERT INTO entities(id,meta,is_cited) VALUES (5,'离号',0)`);
    db.close();
    const report = runReconcile({ dbPath, sqlPath: SQL });
    assert.equal(check(report, '5').status, 'FAIL');
    assert.equal(check(report, '7').status, 'FAIL');
    assert.equal(report.counts.entities_max_id, 5);
    assert.equal(report.counts.entities, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('合并态：有合并记录时断号允许(第 7 条 PASS),MIN<1 仍 FAIL,断号走 id_gaps 读数', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-merged-'));
  try {
    const dbPath = buildV28(dir);
    const db = new DatabaseSync(dbPath);
    db.exec(`INSERT INTO entities(id,meta,is_cited) VALUES (5,'离号',0)`);
    db.exec(`INSERT INTO entity_merge_log(id,source_entity_id,target_entity_id) VALUES (1,4,2)`);
    db.close();
    const report = runReconcile({ dbPath, sqlPath: SQL });
    assert.equal(check(report, '7').status, 'PASS', '有合并记录时断号应允许');
    assert.equal(report.counts.id_gaps, 1);
    assert.equal(report.counts.id_merge_log, 1);
    assert.match(formatReport(report), /INFO: 检测到 1 处断号\(合并态,允许\)/);

    const db2 = new DatabaseSync(dbPath);
    db2.exec(`INSERT INTO entities(id,meta,is_cited) VALUES (0,'零号',0)`);
    db2.close();
    const c = check(runReconcile({ dbPath, sqlPath: SQL }), '7');
    assert.equal(c.status, 'FAIL', 'MIN=0 违反 MIN>=1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('变异自证：① 的 <> 改成 = 后，一致库也判 FAIL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-mut-'));
  try {
    const mutated = join(dir, 'mutated.sql');
    writeFileSync(mutated, readFileSync(SQL, 'utf8').replace('e.is_cited <> EXISTS', 'e.is_cited = EXISTS'));
    const c = check(runReconcile({ dbPath: buildV28(dir), sqlPath: mutated }), '1');
    assert.equal(c.status, 'FAIL', '变异后的 ① 仍判 PASS，说明对账没有判别力');
    assert.ok(c.rowCount > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

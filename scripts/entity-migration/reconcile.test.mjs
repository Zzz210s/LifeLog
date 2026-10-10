/** T1.0 对账脚本测试（v30 旧结构）：SQL 可解析为十条 + 旧库整组 N/A + 计数读数 + 格式化。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseBlocks, runReconcile, formatReport } from './reconcile-lib.mjs';

const SQL = fileURLToPath(new URL('./reconcile.sql', import.meta.url));

const V30_SCHEMA = `
CREATE TABLE entities(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '', parent_id INTEGER, path TEXT, depth INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edges(id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
  kind TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
  UNIQUE(source_id, kind, target_id));
CREATE TABLE entity_aliases(alias TEXT NOT NULL, entity_id INTEGER NOT NULL, PRIMARY KEY(alias, entity_id));
CREATE TABLE entity_merge_log(id INTEGER PRIMARY KEY, source_entity_id INTEGER, target_entity_id INTEGER);
CREATE VIRTUAL TABLE entities_fts USING fts5(meta);`;

function buildV30(dir) {
  const db = new DatabaseSync(join(dir, 'v30.db'));
  db.exec(V30_SCHEMA);
  db.exec(`INSERT INTO entities(id,meta,is_cited,parent_id,path,depth) VALUES
    (1,'工作',0,NULL,'工作',1),(2,'项目',1,1,'工作/项目',2),(3,'第一篇'||char(10)||'正文',0,NULL,NULL,NULL)`);
  db.exec(`INSERT INTO edges(id,source_id,target_id,kind) VALUES (1,1,2,'child'),(2,3,2,'link')`);
  db.exec(`INSERT INTO entities_fts(rowid,meta) VALUES (1,'工作'),(2,'项目'),(3,'第一篇')`);
  db.exec(`INSERT INTO entity_aliases(alias,entity_id) VALUES ('gongzuo',1)`);
  db.exec('PRAGMA user_version=30');
  db.close();
  return join(dir, 'v30.db');
}

const check = (report, n) => report.checks.find((c) => c.n === String(n));
const TEN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

test('reconcile.sql：modern 恰十条 ①–⑩，无 legacy 块，含 points/lines 计数键', () => {
  const blocks = parseBlocks(readFileSync(SQL, 'utf8'));
  assert.ok(blocks.every((b) => b.mode !== 'legacy'), '不应再有 legacy 块');
  for (const n of TEN) assert.ok(blocks.some((b) => b.kind === 'check' && b.n === n), `缺第 ${n} 条`);
  assert.equal(blocks.filter((b) => b.kind === 'check' && b.mode === 'modern').length, 10);
  for (const k of ['points', 'lines', 'lines_tree', 'lines_named', 'lines_unnamed', 'pure_name_points',
    'points_fts', 'is_cited_points', 'tree_closure_points', 'feed_default_points']) {
    assert.ok(blocks.some((b) => b.kind === 'count' && b.key === k), `缺计数键 ${k}`);
  }
});

test('v30 库：十条整组 N/A（无 points 表），entities / edges 读数仍在，十条不崩', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-v30-'));
  try {
    const report = runReconcile({ dbPath: buildV30(dir), sqlPath: SQL });
    assert.equal(report.user_version, 30);
    assert.equal(report.counts.entities, 3);
    assert.equal(report.counts.edges, 2);
    assert.equal(report.counts.entity_aliases, 1);
    assert.equal(report.counts.points, 'N/A');
    assert.equal(report.counts.lines, 'N/A');
    for (const n of TEN) {
      const c = check(report, n);
      assert.equal(c.status, 'N/A', `v30 第 ${n} 条应为 N/A: ${JSON.stringify(c)}`);
    }
    assert.equal(check(report, 'integrity').status, 'PASS');
    assert.equal(check(report, 'fk').status, 'PASS');
    assert.equal(report.summary.na, 10);
    const text = formatReport(report);
    assert.match(text, /user_version=30/);
    assert.match(text, /十条/);
    assert.match(text, /\[7\] 内容点 id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('每条 requires 非空（拉不到 v31 表时必须整块 N/A 而不是执行报错）', () => {
  const blocks = parseBlocks(readFileSync(SQL, 'utf8'));
  for (const n of TEN) {
    const b = blocks.find((x) => x.kind === 'check' && x.n === n);
    assert.ok(b.requires.length > 0, `第 ${n} 条缺 requires`);
  }
});

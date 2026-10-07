/** T0.1 对账脚本测试：reconcile.sql 解析 + 真库形态读数 + 对账能否抓到错（含变异自证）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseBlocks, runReconcile, formatReport } from './reconcile-lib.mjs';

const SQL = fileURLToPath(new URL('./reconcile.sql', import.meta.url));

const LEGACY_SCHEMA = `
CREATE TABLE notes(id INTEGER PRIMARY KEY, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE tags(id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  path TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, color TEXT);
CREATE TABLE tag_links(tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL, remark TEXT NOT NULL DEFAULT '', PRIMARY KEY(tag_id,target_type,target_id));
CREATE TABLE note_links(id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_id INTEGER, raw_title TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE VIRTUAL TABLE notes_fts USING fts5(content, tokenize='trigram');`;

function buildV23(dir) {
  const db = new DatabaseSync(join(dir, 'v23.db'));
  db.exec(LEGACY_SCHEMA);
  db.exec(`WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM s WHERE i<1372)
    INSERT INTO notes(id,content) SELECT i,'' FROM s`);
  db.exec(`INSERT INTO tags(id,name,parent_id,path,depth) VALUES
    (1,'工作',NULL,'工作',1),(2,'项目',1,'工作/项目',2),(3,'生活',NULL,'生活',1)`);
  db.exec(`INSERT INTO tag_links(tag_id,target_type,target_id) VALUES
    (1,'note',1),(2,'note',2),(1,'note',2)`);
  db.exec(`INSERT INTO notes_fts(rowid,content) SELECT id,content FROM notes`);
  db.exec('PRAGMA user_version=23');
  db.close();
  return join(dir, 'v23.db');
}

function buildV24(dir, mismatched) {
  const db = new DatabaseSync(join(dir, 'v24.db'));
  db.exec(`
    CREATE TABLE entities(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT,
      content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, color TEXT, parent_id INTEGER,
      path TEXT, depth INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, legacy_id INTEGER);
    CREATE TABLE edges(id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
      kind TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      UNIQUE(source_id,kind,target_id));`);
  db.exec(`INSERT INTO entities(id,kind,name,created_at,parent_id,path,depth) VALUES
    (1,'tag','工作','2026-10-07',NULL,'工作',1),
    (2,'tag','项目','2026-10-07',1,'工作/项目',2)`);
  db.exec(`INSERT INTO edges(id,source_id,target_id,kind,created_at) VALUES (1,1,2,'child','2026-10-07')`);
  if (mismatched) {
    db.exec(`INSERT INTO entities(id,kind,name,created_at,parent_id,path,depth) VALUES
      (3,'tag','孤儿','2026-10-07',1,'工作/孤儿',2)`);
  }
  db.exec('PRAGMA user_version=24');
  db.close();
  return join(dir, 'v24.db');
}

const check = (report, n, mode) =>
  report.checks.find((c) => c.n === String(n) && c.mode === mode);

test('reconcile.sql 解析出 >= 8 个语句块', () => {
  const blocks = parseBlocks(readFileSync(SQL, 'utf8'));
  assert.ok(blocks.length >= 8, `块数 ${blocks.length} < 8`);
  assert.ok(blocks.some((b) => b.kind === 'count' && b.key === 'notes'));
  assert.ok(blocks.some((b) => b.kind === 'check' && b.mode === 'modern'));
  assert.ok(blocks.some((b) => b.kind === 'check' && b.mode === 'legacy'));
});

test('v23 形态库：notes 读数与五条 legacy 对账全 0 行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-v23-'));
  try {
    const report = runReconcile({ dbPath: buildV23(dir), sqlPath: SQL });
    assert.equal(report.user_version, 23);
    assert.equal(report.counts.notes, 1372);
    assert.equal(report.counts.tags, 3);
    assert.equal(report.counts.tag_links, 3);
    assert.match(formatReport(report), /notes=1372/);
    for (const n of ['1', '2', '3', '4', '5']) {
      const c = check(report, n, 'legacy');
      assert.equal(c.status, 'PASS', `legacy 对账 ${n}: ${JSON.stringify(c.rows)}`);
    }
    assert.equal(check(report, '1', 'modern').status, 'N/A');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v24 形态库：对账 ① 一致时 PASS，插入漂移行后 FAIL 1 行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-v24-'));
  try {
    const dbPath = buildV24(dir, false);
    const ok = runReconcile({ dbPath, sqlPath: SQL });
    assert.equal(check(ok, '1', 'modern').status, 'PASS');

    const db = new DatabaseSync(dbPath);
    db.exec(`INSERT INTO entities(id,kind,name,created_at,parent_id,path,depth) VALUES
      (3,'tag','孤儿','2026-10-07',1,'工作/孤儿',2)`);
    db.close();
    const bad = runReconcile({ dbPath, sqlPath: SQL });
    const c1 = check(bad, '1', 'modern');
    assert.equal(c1.status, 'FAIL');
    assert.equal(c1.rowCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reconcile_detects_cache_drift：把 ① 的 IS NOT 改成 = 后一致库也判 FAIL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-mut-'));
  try {
    const mutated = join(dir, 'mutated.sql');
    writeFileSync(
      mutated,
      readFileSync(SQL, 'utf8').replace('e.parent_id IS NOT c.source_id', 'e.parent_id IS c.source_id'),
    );
    const report = runReconcile({ dbPath: buildV24(dir, false), sqlPath: mutated });
    const c1 = check(report, '1', 'modern');
    assert.notEqual(c1.status, 'PASS', '变异后的 ① 仍判 PASS，说明对账没有判别力');
    assert.ok(c1.rowCount > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

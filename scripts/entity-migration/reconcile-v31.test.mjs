/** T1.0 对账脚本测试（v31 点/线结构）：十条全绿 + 逐条反例 + 保留点/合并态放宽 + 变异自证。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { runReconcile } from './reconcile-lib.mjs';

const SQL = fileURLToPath(new URL('./reconcile.sql', import.meta.url));

const V31_SCHEMA = `
CREATE TABLE points(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '', parent_id INTEGER, path TEXT, depth INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE lines(id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, name_id INTEGER,
  created_at TEXT NOT NULL DEFAULT '', UNIQUE(from_id, to_id, name_id));
CREATE VIRTUAL TABLE points_fts USING fts5(meta, paths);
CREATE TABLE entity_merge_log(id INTEGER PRIMARY KEY, source_entity_id INTEGER, target_entity_id INTEGER);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');`;

/** 一致夹具：保留点 0(子级)、内容点 1(工作)/2(项目)/3(笔记)、关系名点 4(国籍)。
 *  子级线 1->2；无名线 3->2；有名线 3->1(name=国籍)。is_cited=有入非子级线。 */
function buildV31(dir, name = 'v31.db', extra = '') {
  const db = new DatabaseSync(join(dir, name));
  db.exec(V31_SCHEMA);
  db.exec(`INSERT INTO points(id,meta,is_cited,parent_id,path,depth) VALUES
    (0,'子级',0,NULL,NULL,NULL),(1,'工作',1,NULL,'工作',1),(2,'项目',1,1,'工作/项目',2),
    (3,'第一篇'||char(10)||'正文',0,NULL,NULL,NULL),(4,'国籍',0,NULL,NULL,NULL)`);
  db.exec(`INSERT INTO lines(id,from_id,to_id,name_id) VALUES
    (1,1,2,0),(2,3,2,NULL),(3,3,1,4)`);
  db.exec(`INSERT INTO points_fts(rowid,meta) VALUES (1,'工作'),(2,'项目'),(3,'第一篇')`);
  db.exec(`INSERT INTO settings(key,value) VALUES
    ('tree_line_name_id','0'),('graph_positions','{"1":{"x":0,"y":0}}'),('ui.mru.notes','[{"id":"3","count":1}]')`);
  if (extra) db.exec(extra);
  db.exec('PRAGMA user_version=31');
  db.close();
  return join(dir, name);
}

const check = (report, n) => report.checks.find((c) => c.n === String(n));
const TEN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

function withMutated(dir, sql) {
  const p = buildV31(dir, `mut-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(p);
  db.exec(sql);
  db.close();
  return runReconcile({ dbPath: p, sqlPath: SQL });
}

test('v31 库：十条全 PASS + 计数读数逐值', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-v31-'));
  try {
    const report = runReconcile({ dbPath: buildV31(dir), sqlPath: SQL });
    assert.equal(report.user_version, 31);
    for (const n of TEN) {
      const c = check(report, n);
      assert.equal(c.status, 'PASS', `第 ${n} 条: ${JSON.stringify(c.rows)} ${c.error || ''}`);
    }
    assert.deepEqual(
      ['points', 'points_min_id', 'points_max_id', 'lines', 'lines_tree', 'lines_named', 'lines_unnamed',
        'pure_name_points', 'lines_dangling', 'lines_dup_triple', 'points_fts', 'is_cited_points',
        'tree_closure_points', 'feed_default_points', 'id_gaps_points']
        .map((k) => report.counts[k]),
      [5, 0, 4, 3, 1, 1, 1, 2, 0, 0, 3, 2, 2, 1, 0],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('逐条反例：每种漂移至少被对应那一条命中', () => {
  const cases = [
    ['1', "UPDATE points SET is_cited=0 WHERE id=2"],
    ['2', 'UPDATE points SET parent_id=NULL WHERE id=2'],
    ['3', "UPDATE points SET path='工作/项目X' WHERE id=2"],
    ['4', 'UPDATE points SET depth=9 WHERE id=2'],
    ['5', 'INSERT INTO lines(id,from_id,to_id,name_id) VALUES(9,3,2,0)'],
    ['6', "INSERT INTO points(id,meta,is_cited,parent_id,path,depth) VALUES(5,'项目',1,1,'工作/项目',2)"],
    ['7', "INSERT INTO points(id,meta,is_cited) VALUES(9,'离号',0)"],
    ['8', "UPDATE points SET path='国籍' WHERE id=4"],
    ['9', "UPDATE settings SET value='9' WHERE key='tree_line_name_id'"],
    ['10', "UPDATE settings SET value='{\"9\":{\"x\":0}}' WHERE key='graph_positions'"],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-drift-'));
  try {
    for (const [n, sql] of cases) {
      const c = check(withMutated(dir, sql), n);
      assert.equal(c.status, 'FAIL', `第 ${n} 条未命中漂移: ${sql}`);
      assert.ok(c.rowCount > 0, `第 ${n} 条命中但 0 行`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('⑦ 放宽：id=0 保留点与名字点排除在内容点之外；无合并记录时断号仍 FAIL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-id-'));
  try {
    const base = buildV31(dir);
    assert.equal(check(runReconcile({ dbPath: base, sqlPath: SQL }), '7').status, 'PASS');
    assert.equal(check(withMutated(dir, "INSERT INTO points(id,meta,is_cited) VALUES(9,'离号',0)"), '7').status, 'FAIL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('⑦ 合并态：有合并记录时断号允许；MIN<1 仍 FAIL（且不把 id=0 当内容点）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-merge-'));
  try {
    const p = buildV31(dir, 'merge.db', "INSERT INTO points(id,meta,is_cited) VALUES(9,'离号',0)");
    const db = new DatabaseSync(p);
    db.exec('INSERT INTO entity_merge_log(id,source_entity_id,target_entity_id) VALUES(1,8,2)');
    db.close();
    assert.equal(check(runReconcile({ dbPath: p, sqlPath: SQL }), '7').status, 'PASS');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('⑦ 空树库：只有保留点 0、没有任何线时 ⑦ 仍 PASS（位置判据不成立也不误判内容点）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-empty-'));
  try {
    const p = join(dir, 'empty.db');
    const db = new DatabaseSync(p);
    db.exec(V31_SCHEMA);
    db.exec("INSERT INTO points(id,meta,is_cited,parent_id,path,depth) VALUES (0,'子级',0,NULL,NULL,NULL)");
    db.exec("INSERT INTO points_fts(rowid,meta,paths) VALUES (0,'子级','')");
    db.exec(`INSERT INTO settings(key,value) VALUES
      ('tree_line_name_id','0'),('graph_positions','{}'),('ui.mru.notes','[]')`);
    db.exec('PRAGMA user_version=31');
    db.close();
    const rep = runReconcile({ dbPath: p, sqlPath: SQL });
    assert.equal(rep.counts.points, 1);
    assert.equal(check(rep, '7').status, 'PASS', `第 7 条: ${JSON.stringify(check(rep, '7').rows)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('变异自证：① 的 <> 改成 = 后，一致库也判 FAIL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-mut-'));
  try {
    const mutated = join(dir, 'mutated.sql');
    writeFileSync(mutated, readFileSync(SQL, 'utf8').replace('p.is_cited <> EXISTS', 'p.is_cited = EXISTS'));
    const c = check(runReconcile({ dbPath: buildV31(dir), sqlPath: mutated }), '1');
    assert.equal(c.status, 'FAIL', '变异后的 ① 仍判 PASS，说明对账没有判别力');
    assert.ok(c.rowCount > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

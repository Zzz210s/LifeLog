/** T1.5 三条等价性比对器的用例（spec §10.6 硬断言）。
 *  夹具是最小 v30 / v31 一对：闭包 = {1,2,3}（is_cited 只有 {3}），信息流 = {3,4}，
 *  entities_fts / points_fts 各 4 行、paths 逐字节相同。
 *  跑法: node --test scripts/entity-migration/verify-031.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  CLOSURE_V31,
  IS_CITED_V31,
  compareTreeClosure,
  compareFeedDefault,
  compareFtsPaths,
} from './verify-031-lib.mjs';

/** 点 1 根 / 2 在 1 下 / 3 笔记挂 2（is_cited=1）/ 4 树外笔记；闭包 {1,2,3}，is_cited {3}。 */
const POINTS = `INSERT INTO points(id, meta, is_cited, created_at, parent_id, path, depth, sort_order) VALUES
  (1, '工作', 0, '2026-01-01', NULL, '工作', 1, 0),
  (2, '项目', 0, '2026-01-01', 1, '工作/项目', 2, 0),
  (3, '第一篇'||char(10)||'正文', 1, '2026-01-02', 2, NULL, NULL, 0),
  (4, '第二篇'||char(10)||'正文', 0, '2026-01-03', NULL, NULL, NULL, 0);`;
const FTS = `INSERT INTO points_fts(rowid, meta, paths) VALUES
  (1, '工作', '工作'), (2, '项目', '工作/项目'), (3, '第一篇'||char(10)||'正文', ''), (4, '第二篇'||char(10)||'正文', '');`;

function v30Fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE entities(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, parent_id INTEGER, path TEXT, depth INTEGER, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE edges(id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
      kind TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE VIRTUAL TABLE entities_fts USING fts5(meta, paths);
    INSERT INTO entities(id, meta, is_cited, created_at, parent_id, path, depth, sort_order) VALUES
      (1, '工作', 0, '2026-01-01', NULL, '工作', 1, 0),
      (2, '项目', 0, '2026-01-01', 1, '工作/项目', 2, 0),
      (3, '第一篇'||char(10)||'正文', 1, '2026-01-02', 2, NULL, NULL, 0),
      (4, '第二篇'||char(10)||'正文', 0, '2026-01-03', NULL, NULL, NULL, 0);
    INSERT INTO edges(id, source_id, target_id, kind, remark, created_at) VALUES
      (10, 1, 2, 'child', '', '2026-01-01'), (11, 2, 3, 'child', '', '2026-01-02');
    INSERT INTO entities_fts(rowid, meta, paths) VALUES
      (1, '工作', '工作'), (2, '项目', '工作/项目'), (3, '第一篇'||char(10)||'正文', ''), (4, '第二篇'||char(10)||'正文', '');`);
  return db;
}

function v31Fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE points(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, parent_id INTEGER, path TEXT, depth INTEGER, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE lines(id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
      name_id INTEGER, created_at TEXT NOT NULL);
    CREATE VIRTUAL TABLE points_fts USING fts5(meta, paths);
    ${POINTS}
    INSERT INTO lines(id, from_id, to_id, name_id, created_at) VALUES
      (10, 1, 2, 0, '2026-01-01'), (11, 2, 3, 0, '2026-01-02');
    ${FTS}`);
  return db;
}

test('equivalence_three_are_green_on_v30_v31_fixture', () => {
  const a = v30Fixture();
  const b = v31Fixture();
  const tree = compareTreeClosure(a, b);
  const feed = compareFeedDefault(a, b);
  const fts = compareFtsPaths(a, b);
  assert.equal(tree.ok, true);
  assert.equal(tree.bCount, 3);
  assert.equal(feed.ok, true);
  assert.equal(feed.bCount, 2);
  assert.equal(fts.ok, true);
  assert.equal(fts.rowsV31, 4);
});

test('equivalence_tree_closure_is_compared_against_v30', () => {
  const a = v30Fixture();
  const b = v31Fixture();
  assert.equal(compareTreeClosure(a, b).ok, true, '默认比对对象 = v30 闭包，应绿');
  assert.equal(b.prepare(CLOSURE_V31).all().length, 3);
  assert.equal(b.prepare(IS_CITED_V31).all().length, 1, 'is_cited 只有 1 个点');
  // 变异：把比对对象从「v30 闭包」换成「v31 的 is_cited 集合」-> 必须红（1 对 3）
  const mutated = compareTreeClosure(a, b, b, IS_CITED_V31);
  assert.equal(mutated.ok, false);
  assert.equal(mutated.onlyBTotal, 2);
  assert.deepEqual(mutated.onlyB, [1, 2]);
});

test('equivalence_feed_default_is_compared_against_v30', () => {
  const a = v30Fixture();
  const b = v31Fixture();
  assert.equal(compareFeedDefault(a, b).ok, true);
  // 变异：v31 侧改成「全部点」-> 4 对 2，必须红
  const mutated = compareFeedDefault(a, b, 'SELECT id FROM points ORDER BY id');
  assert.equal(mutated.ok, false);
  assert.equal(mutated.onlyBTotal, 2);
});

test('equivalence_fts_paths_are_byte_identical', () => {
  const a = v30Fixture();
  const b = v31Fixture();
  const ok = compareFtsPaths(a, b);
  assert.equal(ok.ok, true);
  assert.equal(ok.hashV30, ok.hashV31);
  b.prepare("UPDATE points_fts SET paths = paths || ' ' WHERE rowid = 1").run();
  const bad = compareFtsPaths(a, b);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.diffIds, [1]);
});

test('v31_queries_fail_on_v30_shape', () => {
  const a = v30Fixture();
  assert.throws(() => compareTreeClosure(a, a), /no such table: points/);
});

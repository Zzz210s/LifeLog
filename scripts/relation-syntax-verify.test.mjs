/** T6 收口验证件的用例:判据在最小 v31 形状夹具(1 条名线 + 1 条 md 形态路径)上的正例,
 *  外加每条判据的**故意写坏负例**(负例保证判据不是恒真)。
 *  跑法: node --test scripts/relation-syntax-verify.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  compareFts,
  compareIds,
  judgeBareParen,
  judgeClearName,
  judgeDelete,
  judgeMetaNameGroup,
  judgeRename,
  judgeRoundtrip,
  namedLines,
  readings,
} from './relation-syntax-verify-lib.mjs';

/** 夹具:点 1 根 / 2 树内目标 / 3 md 形态路径 / 4 名字点「国籍」/ 5 笔记 / 6 备用名字点「籍贯」。
 *  名线 1 = 笔记 5 -> 地点/中国大陆(名字点 4);名线 2 = 笔记 5 -> 地点/[郴](chēn)州市。 */
function mk() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE points(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', path TEXT, is_cited INTEGER NOT NULL DEFAULT 0);
CREATE TABLE lines(id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, name_id INTEGER);
CREATE TABLE points_fts(rowid INTEGER PRIMARY KEY, paths TEXT NOT NULL DEFAULT '');
INSERT INTO points(id, meta, path, is_cited) VALUES
  (1, '地点', '地点', 0),
  (2, '中国大陆', '地点/中国大陆', 0),
  (3, '[郴](chēn)州市', '地点/[郴](chēn)州市', 0),
  (4, '国籍', NULL, 0),
  (5, '正文', NULL, 1),
  (6, '籍贯', NULL, 0);
INSERT INTO lines(id, from_id, to_id, name_id) VALUES (1, 5, 2, 4), (2, 5, 3, 4);
INSERT INTO points_fts(rowid, paths) VALUES
  (1, '地点'), (2, '地点/中国大陆'), (3, '地点/[郴](chēn)州市'), (5, '地点/中国大陆');`);
  return db;
}

/** A5-A7 判据吃的是「某 (来源, 目标) 的线」那份读数 */
const rd = (db) => readings(db, { from: 5, to: 2 });

test('A4 名线三元组往返无损(正例 + 写坏负例)', () => {
  const before = readings(mk());
  assert.equal(judgeRoundtrip(before, readings(mk())).ok, true);
  const broken = mk();
  broken.exec('UPDATE lines SET name_id = NULL WHERE id = 1');
  const r = judgeRoundtrip(before, readings(broken));
  assert.equal(r.ok, false, '少一个名字点必须报红');
  assert.equal(r.named, 2);
  assert.deepEqual(r.diff, ['1|5|2|国籍']);
});

test('A5 清名字可表达(正例 + 写坏负例)', () => {
  const before = rd(mk());
  const cleared = mk();
  cleared.exec('UPDATE lines SET name_id = NULL WHERE id = 1');
  const r = judgeClearName(before, rd(cleared));
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineAfter, { id: 1, from: 5, to: 2, nameId: null });
  const untouched = mk();
  untouched.exec("UPDATE points SET meta = '正文改' WHERE id = 5");
  const bad = judgeClearName(before, rd(untouched));
  assert.equal(bad.ok, false, '名字还在就不能算清名字');
  assert.equal(bad.lineAfter.nameId, 4);
});

test('A6 改名可表达:线 id 不变、name_id 换点(正例 + 写坏负例)', () => {
  const before = rd(mk());
  const renamed = mk();
  renamed.exec('UPDATE lines SET name_id = 6 WHERE id = 1');
  const r = judgeRename(before, rd(renamed));
  assert.equal(r.ok, true);
  assert.equal(r.lineAfter.nameId, 6);
  const recreated = mk();
  recreated.exec("DELETE FROM lines WHERE id = 1; INSERT INTO lines(id, from_id, to_id, name_id) VALUES (9, 5, 2, 6)");
  const bad = judgeRename(before, rd(recreated));
  assert.equal(bad.ok, false, '线被删了重建(线 id 变了)必须报红');
  assert.equal(bad.lineAfter.id, 9);
});

test('A7 删除可表达:线与名字点消失,其它目标的线不受影响', () => {
  const before = rd(mk());
  const deleted = mk();
  deleted.exec('DELETE FROM lines WHERE id = 1');
  const r = judgeDelete(before, rd(deleted));
  assert.equal(r.ok, true);
  assert.equal(r.lineAfter, null);
  assert.equal(r.keptOthers, 1, '另一条名线照旧');
  const kept = mk();
  const bad = judgeDelete(before, rd(kept));
  assert.equal(bad.ok, false, '线还在就是没删掉');
  assert.equal(bad.lineAfter.id, 1);
});

test('A9 正文不得残留 #目标(名字)(正例 + 写坏负例)', () => {
  assert.equal(judgeMetaNameGroup(readings(mk())).ok, true);
  const dirty = mk();
  dirty.exec("UPDATE points SET meta = '正文' || char(10) || '#地点/中国大陆(国籍)' WHERE id = 5");
  const r = judgeMetaNameGroup(readings(dirty));
  assert.equal(r.ok, false);
  assert.deepEqual(r.rows, [{ id: 5, meta: '正文\n#地点/中国大陆(国籍)' }]);
});

test('A12 裸括号禁令:md 形态放行、裸括号判违规', () => {
  const ok = judgeBareParen(readings(mk()));
  assert.equal(ok.ok, true);
  assert.equal(ok.parenPaths.length, 1, '夹具里那条 md 形态路径要被数出来');
  assert.equal(ok.parenPaths[0].path, '地点/[郴](chēn)州市');
  const dirty = mk();
  dirty.exec("INSERT INTO points(id, meta, path) VALUES (7, '工作(重要)', '工作(重要)')");
  const r = judgeBareParen(readings(dirty));
  assert.equal(r.ok, false);
  assert.deepEqual(r.tree, [7]);
});

test('A2 FTS 比对:同形状相等,paths 文本不同但行数相同必须报红', () => {
  assert.equal(compareFts(readings(mk()), readings(mk())).ok, true);
  const drifted = mk();
  drifted.exec("UPDATE points_fts SET paths = '地点/中国大陆X' WHERE rowid = 2");
  const r = compareFts(readings(mk()), readings(drifted));
  assert.equal(r.rowsA, r.rowsB, '负例的前提:两边行数相同');
  assert.equal(r.ok, false, '只比行数会漏掉文本漂移 —— 这条负例就是变异自证的靶子');
  assert.equal(r.reason, 'paths 字节不同');
});

test('A10 名字点不进 FTS(正例 + 写坏负例)', () => {
  const ok = readings(mk());
  assert.equal(ok.namePointFts, 0);
  assert.equal(ok.named.length, 2);
  const dirty = mk();
  dirty.exec("INSERT INTO points_fts(rowid, paths) VALUES (4, '国籍')");
  assert.equal(readings(dirty).namePointFts, 1, '名字点若进了 FTS 必须被数出来');
});

test('A1 命中集逐值与顺序比对', () => {
  assert.equal(compareIds('命中', [5, 9, 11], [5, 9, 11]).ok, true);
  const unordered = compareIds('命中', [5, 9, 11], [9, 5, 11]);
  assert.equal(unordered.ok, false, '顺序变了也算变');
  assert.equal(compareIds('命中', [5], [5, 9]).ok, false, '长度不同也算变');
});

test('namedLines 只数有名线(子级线的 name_id = 0 不算)', () => {
  const db = mk();
  db.exec('INSERT INTO lines(id, from_id, to_id, name_id) VALUES (3, 2, 3, 0)');
  assert.equal(namedLines(db).length, 2);
});

/** 时间轴收敛比对器用例（计划 T3/T5）。
 *  比对器吃的是 `readAxis` 的输出形状；这里手写最小快照，不碰真库、不依赖 python。
 *  跑法: node --test scripts/entity-migration/time-axis-lib.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapDayLayer, compareTree, compareCreatedAt } from './time-axis-lib.mjs';

const base = () => ({
  readings: { points: 100, lines: 200, fts: 90, tree: 50, closure: 50, cited: 10, feed: 80, merge_log: 1, time_nodes: 20, time_edges: 19, date_layer: 5 },
  signatures: { points: 'P', lines: 'L', fts: 'F', settings: 'S' },
  notes: { 1: '2026-09-17 12:00:00', 2: '2026-09-17 12:00:00' },
  note_tags: { 1: ['时间/日期/2026/10/05', '电影'], 2: ['时间/出版年份/1994'] },
  days: {}, multi: {}, bad: [], feed_ids: [1, 2], point_ids: [1, 2, 7, 8, 9],
  settings: { time_tag_template: '时间/{y}/{m}/{d}', filter_current: '{}' },
  date_layer_ids: [7, 8, 9], integrity: 'ok', fk: 0,
});

/** S1 后：删 2 个容器(8/9)，各读数 -2、merge_log +1，标签前缀改 `时间/日期` -> `时间`。 */
const treeAfter = () => {
  const s = base();
  s.point_ids = [1, 2, 7];
  s.date_layer_ids = [];
  s.readings = { ...s.readings, points: 98, lines: 198, fts: 88, tree: 48, closure: 48, merge_log: 2, time_nodes: 18, time_edges: 17, date_layer: 0 };
  s.note_tags = { 1: ['时间/2026/10/05', '电影'], 2: ['时间/出版年份/1994'] };
  return s;
};

test('map_day_layer_moves_date_prefix', () => {
  assert.equal(mapDayLayer('时间/日期/2026/10/05'), '时间/2026/10/05');
  assert.equal(mapDayLayer('时间/日期'), '时间');
  assert.equal(mapDayLayer('时间/出版年份/1994'), '时间/出版年份/1994');
  assert.equal(mapDayLayer('电影'), '电影');
});

test('tree_compare_is_green_on_pre_and_post_fixture', () => {
  const t = compareTree(base(), treeAfter());
  assert.equal(t.ok, true);
  assert.equal(t.del, 2);
  assert.equal(t.merges, 1);
  assert.deepEqual(t.gone, [8, 9]);
  assert.equal(t.e1diff.length, 0);
  assert.equal(t.mergeDelta, 1);
  assert.equal(t.feedOk, true);
  assert.equal(t.leftover, 0);
});

test('tree_compare_detects_tag_drift', () => {
  const before = base();
  before.note_tags[1] = [...before.note_tags[1], '时间/日期/9999/99/99'];
  const t = compareTree(before, treeAfter());
  assert.equal(t.ok, false);
  assert.deepEqual(t.e1diff.map((d) => d.id), ['1'], '多的那条标签无对应，必须报差异');
});

test('tree_compare_detects_count_drift_and_settings_residue', () => {
  const after = treeAfter();
  after.readings.closure += 1;
  assert.deepEqual(compareTree(base(), after).e2bad, ['closure']);
  const residue = treeAfter();
  residue.settings.filter_current = '{"items":[{"path":"时间/日期"}]}';
  const t = compareTree(base(), residue);
  assert.equal(t.ok, false);
  assert.equal(t.e6.some((x) => x.residue), true, '三键残留 时间/日期 必须报');
});

const s2Base = () => {
  const s = treeAfter();
  s.days = { 1: '2026-10-05' };
  s.notes = { 1: '2026-09-17 12:00:00', 2: '2026-09-17 12:00:00' };
  return s;
};
const s2After = () => {
  const s = treeAfter();
  s.days = { 1: '2026-10-05' };
  s.notes = { 1: '2026-10-05 00:00:00', 2: '2026-09-17 12:00:00' };
  return s;
};

test('created_at_compare_is_green_when_aligned_and_untouched', () => {
  const c = compareCreatedAt(s2Base(), s2After());
  assert.equal(c.ok, true);
  assert.equal(c.hits, 1);
  assert.equal(c.aligned, 1);
  assert.equal(c.untouched, 1);
  assert.deepEqual(c.untouchedDiff, []);
  assert.deepEqual(c.readDiff, []);
  assert.deepEqual(c.sigDiff, []);
});

test('created_at_compare_detects_nonzero_seconds', () => {
  const after = s2After();
  after.notes[1] = '2026-10-05 12:34:56';
  const c = compareCreatedAt(s2Base(), after);
  assert.equal(c.ok, false, '时分秒未归零必须红');
  assert.equal(c.aligned, 0);
});

test('created_at_compare_detects_untouched_note_change', () => {
  const after = s2After();
  after.notes[2] = '2026-09-17 12:00:01';
  const c = compareCreatedAt(s2Base(), after);
  assert.equal(c.ok, false);
  assert.deepEqual(c.untouchedDiff, ['2']);
});

test('created_at_compare_detects_other_reading_change', () => {
  const after = s2After();
  after.readings.points -= 1;
  const c = compareCreatedAt(s2Base(), after);
  assert.equal(c.ok, false);
  assert.deepEqual(c.readDiff, ['points']);
});

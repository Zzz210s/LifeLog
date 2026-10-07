import { describe, expect, it } from 'vitest';
import type { SortCond } from '../../shared/filter-conditions';
import { MAX_SORT_CONDS } from '../../shared/filter-conditions';
import {
  addSort,
  dirLabel,
  hasSortAxis,
  moveSort,
  removeSort,
  setSortDir,
  sortAxisLabel,
  sortChipLabel,
  sortCondKey,
  sortHintLabel,
  toggleSort,
} from './sort-conditions';

const TIME_DESC: SortCond = { kind: 'time', dir: 'desc', enabled: true };
const TIME_ASC: SortCond = { kind: 'time', dir: 'asc', enabled: true };
const PLACE_ASC: SortCond = { kind: 'tag', path: '地点', dir: 'asc', enabled: true };
const PLACE_DESC: SortCond = { kind: 'tag', path: '地点', dir: 'desc', enabled: true };

describe('dirLabel:方向文案随维度变(设计 §4.4 表)', () => {
  it('时间 = 新 -> 旧 / 旧 -> 新', () => {
    expect(dirLabel(TIME_DESC)).toBe('新 -> 旧');
    expect(dirLabel(TIME_ASC)).toBe('旧 -> 新');
  });

  it('标签轴 = 选项顺序 / 选项倒序', () => {
    expect(dirLabel(PLACE_ASC)).toBe('选项顺序');
    expect(dirLabel(PLACE_DESC)).toBe('选项倒序');
    // 同一 dir 值在两种维度下文案必须不同(防止把 tag 分支写成时间文案)
    expect(dirLabel({ ...PLACE_ASC, dir: 'desc' })).not.toBe(dirLabel(TIME_DESC));
  });

  it('维度名与 chip 文案', () => {
    expect(sortAxisLabel(TIME_DESC)).toBe('时间');
    expect(sortAxisLabel(PLACE_ASC)).toBe('地点');
    expect(sortChipLabel(TIME_DESC)).toBe('排序: 新 -> 旧');
    expect(sortChipLabel(TIME_ASC)).toBe('排序: 旧 -> 新');
    expect(sortChipLabel(PLACE_ASC)).toBe('排序: 地点 选项顺序');
  });
});

describe('sortHintLabel:提示行取第一条启用项(设计 §4.7)', () => {
  it('无启用项沿用 最新在前;空数组同', () => {
    expect(sortHintLabel([])).toBe('最新在前');
    expect(sortHintLabel([{ ...TIME_ASC, enabled: false }])).toBe('最新在前');
    expect(sortHintLabel([{ ...PLACE_ASC, enabled: false }])).toBe('最新在前');
  });

  it('第一条启用项决定文案;停用项被跳过', () => {
    expect(sortHintLabel([TIME_ASC])).toBe('最早在前');
    expect(sortHintLabel([TIME_DESC])).toBe('最新在前');
    expect(sortHintLabel([PLACE_ASC])).toBe('地点 选项顺序');
    expect(sortHintLabel([{ ...TIME_DESC, enabled: false }, PLACE_ASC])).toBe('地点 选项顺序');
  });
});

describe('sortCondKey / hasSortAxis:同一轴不允许两条', () => {
  it('时间恒同键;标签按路径;方向与启用态不参与', () => {
    expect(sortCondKey(TIME_DESC)).toBe(sortCondKey(TIME_ASC));
    expect(sortCondKey(PLACE_ASC)).toBe(sortCondKey(PLACE_DESC));
    expect(sortCondKey(PLACE_ASC)).not.toBe(sortCondKey(TIME_ASC));
    expect(hasSortAxis([TIME_DESC], PLACE_ASC)).toBe(false);
    expect(hasSortAxis([PLACE_DESC], PLACE_ASC)).toBe(true);
    expect(hasSortAxis([TIME_ASC], TIME_DESC)).toBe(true);
  });
});

describe('addSort:追加 + 去重 + 上限 5', () => {
  it('不同轴可追加,顺序即优先级', () => {
    expect(addSort([], TIME_DESC)).toEqual([TIME_DESC]);
    expect(addSort([TIME_DESC], PLACE_ASC)).toEqual([TIME_DESC, PLACE_ASC]);
  });

  it('同轴重复添加返回原数组引用(不改引用便于判等)', () => {
    const base = [TIME_DESC];
    expect(addSort(base, TIME_ASC)).toBe(base);
    const tags = [PLACE_ASC];
    expect(addSort(tags, PLACE_DESC)).toBe(tags);
  });

  it(`第 ${MAX_SORT_CONDS} 条可加,第 ${MAX_SORT_CONDS + 1} 条被拒`, () => {
    const five = [TIME_DESC, PLACE_ASC, { ...PLACE_ASC, path: '状态' }, { ...PLACE_ASC, path: '作者' }, { ...PLACE_ASC, path: '时间' }];
    expect(five).toHaveLength(MAX_SORT_CONDS);
    const base = five.slice();
    const added = addSort(base, { kind: 'tag', path: '标签', dir: 'asc', enabled: true });
    expect(added).toBe(base);
    expect(added).toHaveLength(MAX_SORT_CONDS);
  });
});

describe('toggleSort / setSortDir / moveSort / removeSort:逐条编辑', () => {
  const list: SortCond[] = [TIME_DESC, PLACE_ASC, { kind: 'tag', path: '状态', dir: 'asc', enabled: true }];

  it('勾选只改该条 enabled', () => {
    const next = toggleSort(list, 1);
    expect(next.map((s) => s.enabled)).toEqual([true, false, true]);
    expect(next[0]).toBe(list[0]); // 其它条不重建引用
  });

  it('改方向只改该条 dir,且不越维', () => {
    expect(setSortDir(list, 1, 'desc')[1]).toEqual(PLACE_DESC);
    expect(setSortDir(list, 0, 'asc')[0]).toEqual(TIME_ASC);
  });

  it('下移把第 0 条换到第 1 位', () => {
    expect(moveSort(list, 0, 1).map(sortCondKey)).toEqual(['tag:地点', 'time', 'tag:状态']);
  });

  it('上移越界 / 下移越界原样返回', () => {
    expect(moveSort(list, 0, -1)).toBe(list);
    expect(moveSort(list, list.length - 1, 1)).toBe(list);
  });

  it('移除只去掉该下标', () => {
    expect(removeSort(list, 1)).toEqual([TIME_DESC, list[2]]);
  });
});

// @vitest-environment node
/**
 * 分组的纯函数真源(设计 §6.1/§9-13):会话折叠键、方向文案、chip 文案,
 * 以及「分组不算收窄条件」(不影响 isFilterEmpty,不参与命中数)。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, isFilterEmpty } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { chipsOf } from './filter-chips';
import { NONE_GROUP_KEY, groupChipLabel, groupDirLabel, groupSessionKey } from './group-by';

const groupBy = (path: string, dir: 'asc' | 'desc' = 'asc'): FilterConditions => ({
  ...EMPTY_FILTER,
  groupBy: { path, dir },
});

describe('分组会话键与文案', () => {
  it('哨兵组(null 键)用一个稳定字符串,真实路径原样作键', () => {
    expect(groupSessionKey(null)).toBe(NONE_GROUP_KEY);
    expect(groupSessionKey(NONE_GROUP_KEY)).toBe(NONE_GROUP_KEY);
    expect(groupSessionKey('地点/美国')).toBe('地点/美国');
  });

  it('方向文案与排序标签轴同口径:asc = 选项顺序 / desc = 选项倒序', () => {
    expect(groupDirLabel('asc')).toBe('选项顺序');
    expect(groupDirLabel('desc')).toBe('选项倒序');
  });

  it('chip 文案 = `分组: 地点 选项顺序`', () => {
    expect(groupChipLabel({ path: '地点', dir: 'asc' })).toBe('分组: 地点 选项顺序');
    expect(groupChipLabel({ path: '地点', dir: 'desc' })).toBe('分组: 地点 选项倒序');
  });
});

describe('分组 chip 与「不算收窄条件」', () => {
  it('有 groupBy 时多出一个 group chip,单删只清 groupBy', () => {
    const c = groupBy('地点');
    const chips = chipsOf(c);
    const chip = chips.find((x) => x.kind === 'group');
    expect(chip?.label).toBe('分组: 地点 选项顺序');
    expect(chip?.remove.groupBy).toBe(null);
    // 分组 chip 不是收窄条件:没有 groupIndex(它不属于任何条件组)
    expect(chip?.groupIndex).toBeUndefined();
  });

  it('没有分组就没有 group chip', () => {
    expect(chipsOf(EMPTY_FILTER).some((x) => x.kind === 'group')).toBe(false);
  });

  it('分组不影响 isFilterEmpty(空条件 + 分组 = 仍算空条件)', () => {
    expect(isFilterEmpty(groupBy('地点'))).toBe(true);
  });

  it('删分组 chip 不动其它条件(排序保留)', () => {
    const c: FilterConditions = {
      ...groupBy('地点'),
      sorts: [{ kind: 'time', dir: 'asc', enabled: true }],
    };
    const chip = chipsOf(c).find((x) => x.kind === 'group');
    expect(chip?.remove.sorts).toEqual(c.sorts);
    expect(chip?.remove.groupBy).toBe(null);
  });
});

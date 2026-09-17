import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, isFilterEmpty } from '../../shared/filter-conditions';
import { TAB_PRESETS, presetByKey } from './tab-presets';

const preset = (key: string) => TAB_PRESETS.find((p) => p.key === key)!;

describe('标签页预设(S7 的前端常量,旧内置三视图就地转正)', () => {
  it('全部 = 空条件(全部笔记、最新在前)', () => {
    expect(preset('all').conditions).toEqual(EMPTY_FILTER);
    expect(isFilterEmpty(preset('all').conditions)).toBe(true);
  });

  it('待办 = `待办` 含子级(不再有排除条件,也没有旧的 todo/done 精确匹配)', () => {
    const c = preset('todo').conditions;
    expect(c.tags).toEqual([{ path: '待办', includeChildren: true }]);
    expect(c.excludeTags).toEqual([]);
    expect(c.keyword).toBeNull();
    expect(c.tagPresence).toBeNull();
    expect(c.expr).toBeNull();
    expect(c.sort).toBe('newest');
  });

  it('无标签 = 无任何标签(tagPresence none,不含引入/排除标签)', () => {
    const c = preset('untagged').conditions;
    expect(c.tagPresence).toBe('none');
    expect(c.tags).toEqual([]);
    expect(c.excludeTags).toEqual([]);
    expect(isFilterEmpty(c)).toBe(false);
  });

  it('三个预设键与菜单标题齐全且唯一;按 key 取用', () => {
    expect(TAB_PRESETS.map((p) => [p.key, p.title])).toEqual([
      ['all', '全部'],
      ['todo', '待办'],
      ['untagged', '无标签'],
    ]);
    expect(presetByKey('todo')).toEqual(preset('todo'));
    expect(() => presetByKey('nope' as 'all')).toThrow('未知的标签页预设');
  });
});

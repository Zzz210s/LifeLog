/**
 * 摘要侧用例:中文骨架、`+携带` 独立片段,以及 `applyTagPick` 的幂等去重。
 * chip 侧用例在 `filter-chips.test.ts`(拆分守 200 行红线)。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, allItems, itemPaths } from '../../shared/filter-conditions';
import { applyTagPick, summaryOf, summarySegmentsOf } from './filter-chips';

const ASC = [{ kind: 'time', dir: 'asc', enabled: true }] as const;
const c = { ...EMPTY_FILTER, keyword: '电影', tags: [{ path: '工作', includeChildren: true }], tagPresence: 'none' as const, sort: 'oldest' as const, sorts: [...ASC] };

describe('summaryOf', () => {
  it('中文一句话', () => { expect(summaryOf(c)).toBe('关键词「电影」;标签 工作+携带;无标签;1 条排序'); });
  it('空条件为空串', () => { expect(summaryOf(EMPTY_FILTER)).toBe(''); });
  it('摘要不出现含子级注释', () => { expect(summaryOf(c)).not.toContain('含子级'); });
});

describe('summaryOf 补充', () => {
  it('排除/多标签都进摘要', () => {
    const cc = {
      ...EMPTY_FILTER,
      tags: [{ path: '工作', includeChildren: true }, { path: '生活/健身', includeChildren: false }],
      excludeTags: [{ path: '临时', includeChildren: false }],
    };
    expect(summaryOf(cc)).toBe('标签 工作+携带、生活/健身+携带;排除 临时+携带');
  });
  it('仅有排序也入摘要:N 条排序(与 isFilterEmpty 的收窄口径解耦)', () => {
    expect(summaryOf({ ...EMPTY_FILTER, sorts: [...ASC] })).toBe('1 条排序');
    expect(
      summaryOf({
        ...EMPTY_FILTER,
        sorts: [...ASC, { kind: 'tag', path: '地点', dir: 'asc', enabled: true }],
      })
    ).toBe('2 条排序');
  });

  it('排序全停用不进摘要', () => {
    expect(summaryOf({ ...EMPTY_FILTER, sorts: [{ kind: 'time', dir: 'asc', enabled: false }] })).toBe('');
  });
});

describe('携带标记 +携带', () => {
  it('引入与排除的每个标签条件后都跟 +携带', () => {
    const cc = {
      ...EMPTY_FILTER,
      tags: [{ path: '地点/国籍/日本', includeChildren: true }],
      excludeTags: [{ path: '临时', includeChildren: false }],
    };
    expect(summaryOf(cc)).toBe('标签 地点/国籍/日本+携带;排除 临时+携带');
  });

  it('+携带 是独立片段(carry=true),供渲染成小字', () => {
    const cc = {
      ...EMPTY_FILTER,
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [{ path: '临时', includeChildren: false }],
    };
    const segs = summarySegmentsOf(cc);
    expect(segs.filter((s) => s.carry).map((s) => s.text)).toEqual(['+携带', '+携带']);
    expect(segs.map((s) => s.text).join('')).toBe(summaryOf(cc));
  });

  it('无标签条件时摘要里没有 +携带', () => {
    expect(summaryOf({ ...EMPTY_FILTER, keyword: '电影' })).not.toContain('+携带');
  });
});

describe('applyTagPick 补充', () => {
  it('已存在同路径(含子级开关不同)不重复也不改写', () => {
    const once = applyTagPick(EMPTY_FILTER, '工作', { exclude: false, includeChildren: true });
    const twice = applyTagPick(once, '工作', { exclude: false, includeChildren: false });
    expect(itemPaths(twice, 'tag')).toHaveLength(1);
    expect(allItems(twice)).toEqual([{ kind: 'tag', path: '工作', includeChildren: true }]);
  });
  it('排除侧同样不重复;引入与排除互不影响', () => {
    const a = applyTagPick(EMPTY_FILTER, '临时', { exclude: true, includeChildren: false });
    const b = applyTagPick(a, '临时', { exclude: true, includeChildren: true });
    expect(itemPaths(b, 'excludeTag')).toHaveLength(1);
    const c2 = applyTagPick(b, '工作', { exclude: false, includeChildren: true });
    expect(itemPaths(c2, 'excludeTag')).toHaveLength(1);
    expect(itemPaths(c2, 'tag')).toHaveLength(1);
  });
});

describe('applyTagPick', () => {
  it('不重复添加同一路径', () => {
    const once = applyTagPick(EMPTY_FILTER, '工作', { exclude: false, includeChildren: true });
    const twice = applyTagPick(once, '工作', { exclude: false, includeChildren: true });
    expect(itemPaths(twice, 'tag')).toHaveLength(1);
  });
  it('排除项进入 excludeTags', () => {
    const r = applyTagPick(EMPTY_FILTER, '临时', { exclude: true, includeChildren: true });
    expect(allItems(r)).toEqual([{ kind: 'excludeTag', path: '临时', includeChildren: true }]);
  });
});

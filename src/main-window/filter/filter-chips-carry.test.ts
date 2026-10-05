import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import { summaryOf, summarySegmentsOf, summaryTitleOf } from './filter-chips';

describe('表达式里的标签叶子也标 +携带', () => {
  it('含 #T 时叶子后跟 +携带,不含标签时没有(判别力)', () => {
    const withTags = { ...EMPTY_FILTER, expr: '#工作 AND NOT #临时' };
    expect(summaryOf(withTags)).toBe('表达式:#工作+携带 AND NOT #临时+携带');
    const carry = summarySegmentsOf(withTags).filter((s) => s.carry).map((s) => s.text);
    expect(carry).toEqual(['+携带', '+携带']);
    const noTags = { ...EMPTY_FILTER, expr: '"买牛奶" OR todo' };
    expect(summaryOf(noTags)).toBe('表达式:"买牛奶" OR todo');
    expect(summarySegmentsOf(noTags).some((s) => s.carry)).toBe(false);
  });
});

describe('+携带 只在真有携带者时显示', () => {
  const cond = {
    ...EMPTY_FILTER,
    tags: [
      { path: '工作', includeChildren: true },
      { path: '临时', includeChildren: false },
    ],
    excludeTags: [{ path: '生活', includeChildren: false }],
    expr: '#工作 AND #临时',
  };

  it('数据未就绪(null)时退回现在的行为:都显示', () => {
    const all = '标签 工作+携带、临时+携带;排除 生活+携带;表达式:#工作+携带 AND #临时+携带';
    expect(summaryOf(cond)).toBe(all);
    expect(summaryOf(cond, null)).toBe(all);
  });

  it('拿到集合后只标真有携带者的路径(标签组与表达式叶子同一判据)', () => {
    expect(summaryOf(cond, new Set(['工作']))).toBe(
      '标签 工作+携带、临时;排除 生活;表达式:#工作+携带 AND #临时'
    );
    expect(summaryOf(cond, new Set())).toBe('标签 工作、临时;排除 生活;表达式:#工作 AND #临时');
  });

  it('摘要 title 与摘要同口径(未截断)', () => {
    expect(summaryTitleOf(cond, new Set(['临时']))).toBe(
      '标签 工作、临时+携带;排除 生活;表达式:#工作 AND #临时+携带'
    );
  });
});

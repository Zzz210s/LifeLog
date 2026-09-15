import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  MAX_FILTER_TAG_ITEMS,
  filterKey,
  isFilterEmpty,
  isValidTagPath,
  validateFilter,
} from './filter-conditions';
import { canEvaluateLocally, matchesTagsByPath } from './filter-conditions-local';
import { normalizeFilter, parseFilterJson } from './filter-conditions-parse';
import type { FilterConditions, TagCond } from './filter-conditions';

const tag = (path: string, includeChildren = false): TagCond => ({ path, includeChildren });
const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });

describe('EMPTY_FILTER 与 isFilterEmpty', () => {
  it('默认条件为空、最新在前', () => {
    expect(EMPTY_FILTER).toEqual({
      keyword: null,
      tags: [],
      excludeTags: [],
      from: null,
      to: null,
      tagPresence: null,
      sort: 'newest',
    });
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
  });

  it('空白关键词与排序不算收窄', () => {
    expect(isFilterEmpty(cond({ keyword: '   ' }))).toBe(true);
    expect(isFilterEmpty(cond({ sort: 'oldest' }))).toBe(true);
  });

  it('任一收窄字段即非空', () => {
    expect(isFilterEmpty(cond({ keyword: '电影' }))).toBe(false);
    expect(isFilterEmpty(cond({ tags: [tag('工作', true)] }))).toBe(false);
    expect(isFilterEmpty(cond({ excludeTags: [tag('临时')] }))).toBe(false);
    expect(isFilterEmpty(cond({ from: '2026-08-01' }))).toBe(false);
    expect(isFilterEmpty(cond({ to: '2026-09-13' }))).toBe(false);
    expect(isFilterEmpty(cond({ tagPresence: 'none' }))).toBe(false);
  });
});

describe('filterKey', () => {
  it('值相同即同键(含子级开关参与比较)', () => {
    expect(filterKey(cond({ keyword: 'a', tags: [tag('x', true)] }))).toBe(
      filterKey(cond({ keyword: 'a', tags: [tag('x', true)] }))
    );
    expect(filterKey(cond({ tags: [tag('x', true)] }))).not.toBe(filterKey(cond({ tags: [tag('x')] })));
    expect(filterKey(cond({ keyword: 'a' }))).not.toBe(filterKey(cond({ keyword: 'b' })));
  });
});

describe('isValidTagPath', () => {
  it('合法路径:中文、层级、内部点号', () => {
    expect(isValidTagPath('工作')).toBe(true);
    expect(isValidTagPath('工作/项目A/会议')).toBe(true);
    expect(isValidTagPath('v1.0')).toBe(true);
    expect(isValidTagPath('a-b_c')).toBe(true);
  });

  it('非法路径:空段、首尾/连续斜杠、空白、超深', () => {
    expect(isValidTagPath('')).toBe(false);
    expect(isValidTagPath('a//b')).toBe(false);
    expect(isValidTagPath('a/')).toBe(false);
    expect(isValidTagPath('/a')).toBe(false);
    expect(isValidTagPath('a b')).toBe(false);
    expect(isValidTagPath('a..b')).toBe(false);
    expect(isValidTagPath('.a')).toBe(false);
    expect(isValidTagPath('a/b/c/d/e/f')).toBe(false);
  });
});

describe('validateFilter', () => {
  it('六类非法输入各自拒绝', () => {
    expect(validateFilter(cond({ keyword: 'x'.repeat(201) }))).toContain('关键词');
    expect(
      validateFilter(cond({ tags: Array.from({ length: 21 }, (_, i) => tag(`t${i}`)) }))
    ).toContain('引入标签');
    expect(
      validateFilter(cond({ excludeTags: Array.from({ length: 21 }, (_, i) => tag(`t${i}`)) }))
    ).toContain('排除标签');
    expect(validateFilter(cond({ tags: [tag('')] }))).toContain('标签路径不合法');
    expect(validateFilter(cond({ tags: [tag('a//b')] }))).toContain('标签路径不合法');
    expect(validateFilter(cond({ from: '2026-09-13', to: '2026-08-01' }))).toContain('不能晚于');
    expect(validateFilter(cond({ from: '2026-13-01' }))).toContain('开始日期');
    expect(validateFilter(cond({ to: '2026-02-30' }))).toContain('结束日期');
    expect(validateFilter(cond({ sort: 'sideways' as FilterConditions['sort'] }))).toContain('排序');
    expect(validateFilter(cond({ tagPresence: 'some' as FilterConditions['tagPresence'] }))).toContain('标签有无');
  });

  it('合法条件返回 null(含端点与上限边界)', () => {
    expect(validateFilter(EMPTY_FILTER)).toBeNull();
    expect(validateFilter(cond({ keyword: 'x'.repeat(200) }))).toBeNull();
    expect(
      validateFilter(cond({ tags: Array.from({ length: MAX_FILTER_TAG_ITEMS }, (_, i) => tag(`t${i}`)) }))
    ).toBeNull();
    expect(validateFilter(cond({ from: '2026-02-28', to: '2026-03-01' }))).toBeNull();
  });

  it('关键词按字符数(码点)计,与 Rust chars().count() 对齐', () => {
    // 101 个表情符号 = 101 码点 = 202 个 UTF-16 码元:按码元数会误判超限
    expect(validateFilter(cond({ keyword: '😀'.repeat(101) }))).toBeNull();
    expect(validateFilter(cond({ keyword: '😀'.repeat(201) }))).toContain('关键词');
  });

  it('年份下限 1:0000 年非法(与 Rust y>=1 对齐)', () => {
    expect(validateFilter(cond({ from: '0000-01-01' }))).toContain('开始日期');
    expect(validateFilter(cond({ to: '0001-01-01' }))).toBeNull();
  });
});



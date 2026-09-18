import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  MAX_EXPR_CHARS,
  MAX_FILTER_TAG_ITEMS,
  filterKey,
  hasExpr,
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
      tagPresence: null,
      sort: 'newest',
      expr: null,
    });
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
  });

  it('空白关键词与排序不算收窄,表达式也参与收窄判定', () => {
    expect(isFilterEmpty(cond({ keyword: '   ' }))).toBe(true);
    expect(isFilterEmpty(cond({ sort: 'oldest' }))).toBe(true);
    expect(isFilterEmpty(cond({ expr: '   ' }))).toBe(true);
    expect(isFilterEmpty(cond({ expr: '#工作' }))).toBe(false);
  });

  it('任一收窄字段即非空', () => {
    expect(isFilterEmpty(cond({ keyword: '电影' }))).toBe(false);
    expect(isFilterEmpty(cond({ tags: [tag('工作', true)] }))).toBe(false);
    expect(isFilterEmpty(cond({ excludeTags: [tag('临时')] }))).toBe(false);
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

  it('表达式参与值比较:同原文同键、不同原文不同键、尾随空白不产生新键', () => {
    expect(filterKey(cond({ expr: '#工作 AND NOT #临时' }))).toBe(
      filterKey(cond({ expr: '#工作 AND NOT #临时' }))
    );
    expect(filterKey(cond({ expr: '#工作' }))).not.toBe(filterKey(cond({ expr: '#生活' })));
    expect(filterKey(cond({ expr: '#工作' }))).not.toBe(filterKey(EMPTY_FILTER));
    expect(filterKey(cond({ expr: '#工作 ' }))).toBe(filterKey(cond({ expr: '#工作' })));
  });
});

describe('表达式字段', () => {
  it('表达式字段进入空条件与归一化', () => {
    expect(EMPTY_FILTER.expr).toBeNull();
    expect(normalizeFilter({ ...EMPTY_FILTER, expr: '   ' }).expr).toBeNull();
    expect(normalizeFilter({ ...EMPTY_FILTER, expr: ' #工作 ' }).expr).toBe(' #工作 ');
    expect(normalizeFilter({}).expr).toBeNull();
  });

  it('hasExpr:全空白视为无表达式', () => {
    expect(hasExpr(EMPTY_FILTER)).toBe(false);
    expect(hasExpr(cond({ expr: '  ' }))).toBe(false);
    expect(hasExpr(cond({ expr: '#工作' }))).toBe(true);
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
  it('五类非法输入各自拒绝', () => {
    expect(validateFilter(cond({ keyword: 'x'.repeat(201) }))).toContain('关键词');
    expect(
      validateFilter(cond({ tags: Array.from({ length: 21 }, (_, i) => tag(`t${i}`)) }))
    ).toContain('引入标签');
    expect(
      validateFilter(cond({ excludeTags: Array.from({ length: 21 }, (_, i) => tag(`t${i}`)) }))
    ).toContain('排除标签');
    expect(validateFilter(cond({ tags: [tag('')] }))).toContain('标签路径不合法');
    expect(validateFilter(cond({ tags: [tag('a//b')] }))).toContain('标签路径不合法');
    expect(validateFilter(cond({ sort: 'sideways' as FilterConditions['sort'] }))).toContain('排序');
    expect(validateFilter(cond({ tagPresence: 'some' as FilterConditions['tagPresence'] }))).toContain('标签有无');
  });

  it('表达式长度上限与 Rust expr::MAX_LEN 同口径(500 字)', () => {
    expect(validateFilter(cond({ expr: '#工作'.repeat(100) }))).toBeNull();
    expect(validateFilter(cond({ expr: 'x'.repeat(MAX_EXPR_CHARS + 1) }))).toContain('表达式最多 500 字符');
    expect(validateFilter(cond({ expr: '   ' }))).toBeNull();
  });

  it('合法条件返回 null(含上限边界)', () => {
    expect(validateFilter(EMPTY_FILTER)).toBeNull();
    expect(validateFilter(cond({ keyword: 'x'.repeat(200) }))).toBeNull();
    expect(
      validateFilter(cond({ tags: Array.from({ length: MAX_FILTER_TAG_ITEMS }, (_, i) => tag(`t${i}`)) }))
    ).toBeNull();
  });

  it('关键词按字符数(码点)计,与 Rust chars().count() 对齐', () => {
    // 101 个非 BMP 字符(U+1D11E)= 101 码点 = 202 个 UTF-16 码元:按码元数会误判超限
    expect(validateFilter(cond({ keyword: '\u{1D11E}'.repeat(101) }))).toBeNull();
    expect(validateFilter(cond({ keyword: '\u{1D11E}'.repeat(201) }))).toContain('关键词');
  });
});



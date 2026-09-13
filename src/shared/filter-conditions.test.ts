import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  MAX_FILTER_TAG_ITEMS,
  canEvaluateLocally,
  filterKey,
  isFilterEmpty,
  isValidTagPath,
  matchesTagsByPath,
  parseFilterJson,
  validateFilter,
} from './filter-conditions';
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
});

describe('parseFilterJson', () => {
  it('空串、null、坏 JSON 一律回退默认', () => {
    expect(parseFilterJson(null)).toBe(EMPTY_FILTER);
    expect(parseFilterJson('')).toBe(EMPTY_FILTER);
    expect(parseFilterJson('   ')).toBe(EMPTY_FILTER);
    expect(parseFilterJson('{不是 json')).toBe(EMPTY_FILTER);
    expect(parseFilterJson('"字符串"')).toBe(EMPTY_FILTER);
    expect(parseFilterJson('[1,2]')).toBe(EMPTY_FILTER);
  });

  it('字段类型非法或校验不通过回退默认', () => {
    expect(parseFilterJson(JSON.stringify({ tags: 'x' }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ tags: [{ path: 1 }] }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ tagPresence: 'some' }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ sort: 'sideways' }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ from: '2026-09-13', to: '2026-08-01' }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ keyword: 'x'.repeat(201) }))).toBe(EMPTY_FILTER);
  });

  it('合法条件完整读回,多余字段忽略', () => {
    const raw = JSON.stringify({
      keyword: '电影',
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [{ path: '临时', includeChildren: false }],
      from: '2026-08-01',
      to: '2026-09-13',
      tagPresence: 'any',
      sort: 'oldest',
      unknownField: 42,
    });
    expect(parseFilterJson(raw)).toEqual({
      keyword: '电影',
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [{ path: '临时', includeChildren: false }],
      from: '2026-08-01',
      to: '2026-09-13',
      tagPresence: 'any',
      sort: 'oldest',
    });
  });

  it('缺字段走各自默认,空白关键词归一为 null', () => {
    expect(parseFilterJson(JSON.stringify({ keyword: '  ' }))).toEqual(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ sort: 'oldest' }))).toEqual(cond({ sort: 'oldest' }));
    expect(parseFilterJson(JSON.stringify({ tags: [{ path: '工作' }] }))).toEqual(
      cond({ tags: [tag('工作')] })
    );
  });
});

describe('本地重判(就地更新用)', () => {
  it('仅本级且无排除/日期/有无标签时可本地判定', () => {
    expect(canEvaluateLocally(EMPTY_FILTER)).toBe(true);
    expect(canEvaluateLocally(cond({ tags: [tag('a')], keyword: 'x' }))).toBe(true);
    expect(canEvaluateLocally(cond({ tags: [tag('a', true)] }))).toBe(false);
    expect(canEvaluateLocally(cond({ excludeTags: [tag('x')] }))).toBe(false);
    expect(canEvaluateLocally(cond({ from: '2026-08-01' }))).toBe(false);
    expect(canEvaluateLocally(cond({ tagPresence: 'none' }))).toBe(false);
  });

  it('同路径集合重判(AND)', () => {
    const note = { tags: ['a', 'b/c'] };
    expect(matchesTagsByPath(note, EMPTY_FILTER)).toBe(true);
    expect(matchesTagsByPath(note, cond({ tags: [tag('a'), tag('b/c')] }))).toBe(true);
    expect(matchesTagsByPath(note, cond({ tags: [tag('a'), tag('缺')] }))).toBe(false);
  });
});

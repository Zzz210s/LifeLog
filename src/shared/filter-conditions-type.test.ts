/**
 * 类型筛选条件的形状、持久化与向后兼容(spec 2026-10-05 §4 R4 / §5 条件栏口径)。
 * 重点:老库 filter_current 没有 types/excludeTypes 字段时按「无类型条件」解析。
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  filterKey,
  isFilterEmpty,
  validateFilter,
  type FilterConditions,
} from './filter-conditions';
import { canEvaluateLocally } from './filter-conditions-local';
import { normalizeFilter, parseFilterJson } from './filter-conditions-parse';

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });

describe('类型条件:向后兼容', () => {
  it('旧 JSON(六个字段)解析成空类型条件,不是回退默认', () => {
    const raw = JSON.stringify({
      keyword: '电影',
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [],
      tagPresence: null,
      sort: 'newest',
      expr: null,
    });
    const c = parseFilterJson(raw);
    expect(c.types).toEqual([]);
    expect(c.excludeTypes).toEqual([]);
    expect(c.keyword).toBe('电影');
  });

  it('normalizeFilter 对缺类型字段的外部对象补空数组', () => {
    expect(normalizeFilter({ keyword: '电影' }).types).toEqual([]);
    expect(normalizeFilter({ keyword: '电影' }).excludeTypes).toEqual([]);
  });

  it('类型字段照常解析;非法路径整条回退默认', () => {
    const raw = JSON.stringify({ types: [{ path: '国籍' }], excludeTypes: [{ path: '所在' }] });
    expect(parseFilterJson(raw)).toEqual(cond({ types: [{ path: '国籍' }], excludeTypes: [{ path: '所在' }] }));
    expect(parseFilterJson(JSON.stringify({ types: [{ path: 'a b' }] }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ types: [{ path: 42 }] }))).toBe(EMPTY_FILTER);
  });
});

describe('类型条件:参与空判定 / 值键 / 校验 / 本地重判', () => {
  it('有类型条件就不是空条件,值键随之变化', () => {
    const c = cond({ types: [{ path: '国籍' }] });
    expect(isFilterEmpty(c)).toBe(false);
    expect(filterKey(c)).not.toBe(filterKey(EMPTY_FILTER));
    expect(isFilterEmpty(cond({ excludeTypes: [{ path: '所在' }] }))).toBe(false);
  });

  it('类型路径走标签同一套校验,结构非法给中文原因', () => {
    expect(validateFilter(cond({ types: [{ path: '国籍' }] }))).toBeNull();
    expect(validateFilter(cond({ types: [{ path: 'a//b' }] }))).toContain('标签路径不合法');
    expect(validateFilter(cond({ excludeTypes: [{ path: '工作 项目' }] }))).toContain('标签路径不合法');
  });

  it('有类型条件时不做本地重判(后端语义)', () => {
    expect(canEvaluateLocally(EMPTY_FILTER)).toBe(true);
    expect(canEvaluateLocally(cond({ types: [{ path: '国籍' }] }))).toBe(false);
    expect(canEvaluateLocally(cond({ excludeTypes: [{ path: '所在' }] }))).toBe(false);
  });
});

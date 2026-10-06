/**
 * 关系筛选条件的形状、持久化与向后兼容(设计 2026-10-06 §4 R4 / §10 R10b)。
 * 重点:filter_current 字段由 types/excludeTypes 改名为 relations/excludeRelations,
 * 老库(types/excludeTypes)与最老库(roles/excludeRoles)的**非空**条件都必须回读,
 * 否则一次级联改写就会把存量条件静默抹成空。
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

describe('关系条件:向后兼容(旧字段名回读)', () => {
  it('旧 JSON(六字段)解析成空关系条件,不是回退默认', () => {
    const raw = JSON.stringify({
      keyword: '电影',
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [],
      tagPresence: null,
      sort: 'newest',
      expr: null,
    });
    const c = parseFilterJson(raw);
    expect(c.relations).toEqual([]);
    expect(c.excludeRelations).toEqual([]);
    expect(c.keyword).toBe('电影');
  });

  it('旧字段 types 非空 -> 回读为 relations(漏回读会被静默抹掉)', () => {
    const raw = JSON.stringify({ types: [{ path: '国籍' }], excludeTypes: [{ path: '所在' }] });
    expect(parseFilterJson(raw)).toEqual(
      cond({ relations: [{ path: '国籍' }], excludeRelations: [{ path: '所在' }] })
    );
  });

  it('最老字段名 roles/excludeRoles 非空 -> 同样回读为 relations', () => {
    const raw = JSON.stringify({ roles: [{ path: '国籍' }], excludeRoles: [{ path: '所在' }] });
    expect(parseFilterJson(raw)).toEqual(
      cond({ relations: [{ path: '国籍' }], excludeRelations: [{ path: '所在' }] })
    );
  });

  it('新旧字段同时存在:新字段优先,旧字段不叠加(明确口径)', () => {
    const raw = JSON.stringify({ relations: [{ path: '新' }], types: [{ path: '旧' }] });
    expect(parseFilterJson(raw).relations).toEqual([{ path: '新' }]);
  });

  it('normalizeFilter 对缺关系字段的外部对象补空数组,旧字段名也认', () => {
    expect(normalizeFilter({ keyword: '电影' }).relations).toEqual([]);
    expect(normalizeFilter({ keyword: '电影' }).excludeRelations).toEqual([]);
    const legacy = { keyword: '电影', types: [{ path: '国籍' }] } as unknown as FilterConditions;
    expect(normalizeFilter(legacy).relations).toEqual([{ path: '国籍' }]);
  });

  it('关系字段照常解析;非法路径整条回退默认', () => {
    const raw = JSON.stringify({ relations: [{ path: '国籍' }], excludeRelations: [{ path: '所在' }] });
    expect(parseFilterJson(raw)).toEqual(
      cond({ relations: [{ path: '国籍' }], excludeRelations: [{ path: '所在' }] })
    );
    expect(parseFilterJson(JSON.stringify({ relations: [{ path: 'a b' }] }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ relations: [{ path: 42 }] }))).toBe(EMPTY_FILTER);
  });
});

describe('关系条件:参与空判定 / 值键 / 校验 / 本地重判', () => {
  it('有关系条件就不是空条件,值键随之变化', () => {
    const c = cond({ relations: [{ path: '国籍' }] });
    expect(isFilterEmpty(c)).toBe(false);
    expect(filterKey(c)).not.toBe(filterKey(EMPTY_FILTER));
    expect(isFilterEmpty(cond({ excludeRelations: [{ path: '所在' }] }))).toBe(false);
  });

  it('关系路径走标签同一套校验,结构非法给中文原因', () => {
    expect(validateFilter(cond({ relations: [{ path: '国籍' }] }))).toBeNull();
    expect(validateFilter(cond({ relations: [{ path: 'a//b' }] }))).toContain('标签路径不合法');
    expect(validateFilter(cond({ excludeRelations: [{ path: '工作 项目' }] }))).toContain(
      '标签路径不合法'
    );
  });

  it('有关系条件时不做本地重判(后端语义)', () => {
    expect(canEvaluateLocally(EMPTY_FILTER)).toBe(true);
    expect(canEvaluateLocally(cond({ relations: [{ path: '国籍' }] }))).toBe(false);
    expect(canEvaluateLocally(cond({ excludeRelations: [{ path: '所在' }] }))).toBe(false);
  });
});

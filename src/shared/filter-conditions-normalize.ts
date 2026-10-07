/**
 * 应用外部条件(保存视图 / IPC 入参)时的归一(自 `filter-conditions-parse.ts` 拆出,守 200 行):
 * 与默认值合并补齐缺字段,非法或缺失的 sort/tagPresence 回退默认 —— 防半成品对象进状态机。
 * 日期范围已取消(D2):旧 JSON 里的 `from`/`to` 静默丢弃(这里只读已知字段)。
 * 归一后平铺旧字段清空、条件一律住 `groups`(存量条件不丢)。
 */
import { normalizeGroups, sortsFromLegacy } from './filter-conditions';
import type { FilterConditions, FilterGroup, RelationCond, SortCond } from './filter-conditions';
import { keepExpr, readGroupBy, readSortList } from './filter-conditions-parse';

export function normalizeFilter(c: Partial<FilterConditions> | null | undefined): FilterConditions {
  const rec = (c ?? {}) as Record<string, unknown>;
  return normalizeGroups({
    keyword: c?.keyword ?? null,
    tags: Array.isArray(c?.tags) ? c.tags : [],
    excludeTags: Array.isArray(c?.excludeTags) ? c.excludeTags : [],
    relations: looseRelations(rec, ['relations', 'types', 'roles']),
    excludeRelations: looseRelations(rec, ['excludeRelations', 'excludeTypes', 'excludeRoles']),
    tagPresence: c?.tagPresence === 'any' || c?.tagPresence === 'none' ? c.tagPresence : null,
    sort: c?.sort === 'oldest' ? 'oldest' : 'newest',
    sorts: looseSorts(rec, c?.sort === 'oldest' ? 'oldest' : 'newest'),
    // 宽松口径:分组形状非法只丢分组(不丢整份条件)
    groupBy: readGroupBy(rec.groupBy) ?? null,
    expr: keepExpr(c?.expr ?? null),
    groupOp: rec.groupOp === 'or' ? 'or' : 'and',
    groups: Array.isArray(rec.groups) ? (rec.groups as FilterGroup[]) : [],
  });
}

/** 归一用排序数组:结构合法就用它;不是数组或任一项非法 -> 由旧 sort 合成(宽松,不丢存量条件) */
function looseSorts(rec: Record<string, unknown>, legacy: 'newest' | 'oldest'): SortCond[] {
  const read = readSortList(rec.sorts);
  const sorts = read ?? sortsFromLegacy(legacy);
  // 空数组 + 旧 sort:oldest 是矛盾态(写侧不会产出);按 effective_sorts 口径合成,
  // 否则 filterKey 只认 sorts 会把它当默认,旧排序被静默抹掉
  return sorts.length === 0 ? sortsFromLegacy(legacy) : sorts;
}

/** 宽松关系数组(归一用):按新名 -> 旧名依次取第一个数组;都不是数组则空(R10b 回读) */
function looseRelations(rec: Record<string, unknown>, keys: string[]): RelationCond[] {
  for (const k of keys) if (Array.isArray(rec[k])) return rec[k] as RelationCond[];
  return [];
}

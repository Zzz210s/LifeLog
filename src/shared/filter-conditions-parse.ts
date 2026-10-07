/**
 * 持久化文本解析:filter_current 等外部来源(settings 键、Migrate 结果、IPC 入参)都要先过这里;
 * 结构非法一律回退 EMPTY_FILTER,绝不把半成品对象放进状态机。
 * 条件组(设计 2026-10-06 §5):`groups` 缺失/空 -> 由旧平铺字段合成 `groups[0]`;
 * 归一后平铺字段清空,存量条件**绝不静默丢失**(仓内教训 R10b)。
 * 分组(`groupBy`,§6):缺失/null -> null(不分组);形状非法 -> 整体回退 EMPTY_FILTER。
 */
import { EMPTY_FILTER, normalizeGroups, sortsFromLegacy, validateFilter } from './filter-conditions';
import type { FilterConditions, FilterGroup, GroupByCond, GroupItem, RelationCond, SortCond, TagCond } from './filter-conditions';

/**
 * 解析设置里持久化的条件 JSON:空串 / 坏 JSON / 字段类型非法 / 校验不通过一律回退 EMPTY_FILTER;
 * 未知多余字段忽略(前向兼容)。
 */
export function parseFilterJson(raw: string | null): FilterConditions {
  if (raw === null || raw.trim() === '') return EMPTY_FILTER;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_FILTER;
  }
  const parsed = normalize(data);
  if (parsed === null || validateFilter(parsed) !== null) return EMPTY_FILTER;
  return parsed;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 空白表达式一律归一为 null(仅空判断用 trim;非空文本原样保留 —— 后端也按原文解析,
 *  这样错误位置下的字符下标与用户看到的串一致)。归一模块(loose 口径)也用它。 */
export const keepExpr = (v: string | null): string | null =>
  v === null || v.trim() === '' ? null : v;

/** 缺失/ null -> null;字符串原样;其它类型 -> undefined(非法) */
const readNullableString = (v: unknown): string | null | undefined =>
  v === undefined || v === null ? null : typeof v === 'string' ? v : undefined;

/** 关系数组:非数组或项里 path 非字符串 -> null(非法);缺失 -> 空数组 */
function readRelationList(v: unknown): RelationCond[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out: RelationCond[] = [];
  for (const item of v) {
    if (!isRecord(item) || typeof item.path !== 'string') return null;
    out.push({ path: item.path });
  }
  return out;
}

function readTagList(v: unknown): TagCond[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out: TagCond[] = [];
  for (const item of v) {
    if (!isRecord(item) || typeof item.path !== 'string') return null;
    if (item.includeChildren !== undefined && typeof item.includeChildren !== 'boolean') return null;
    out.push({ path: item.path, includeChildren: item.includeChildren === true });
  }
  return out;
}

/**
 * 排序数组(严格口径):缺失 -> null(交由旧 sort 合成);非数组 -> null;
 * 数组里任一项形状非法 -> undefined(非法,整条条件回退 EMPTY_FILTER)。
 * 缺失 `enabled` 默认 true(与 Rust serde 默认对齐)。
 */
export function readSortList(v: unknown): SortCond[] | null | undefined {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) return null;
  const out: SortCond[] = [];
  for (const item of v) {
    if (!isRecord(item)) return undefined;
    if (item.kind !== 'time' && item.kind !== 'tag') return undefined;
    if (item.dir !== 'asc' && item.dir !== 'desc') return undefined;
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') return undefined;
    const enabled = item.enabled !== false;
    if (item.kind === 'time') {
      out.push({ kind: 'time', dir: item.dir, enabled });
      continue;
    }
    if (typeof item.path !== 'string') return undefined;
    out.push({ kind: 'tag', path: item.path, dir: item.dir, enabled });
  }
  return out;
}

/**
 * 分组条件:缺失/null -> null(不分组);非对象或 path 非字符串 / dir 非法值 -> undefined(整条非法)。
 * `dir` 缺失落 `asc`(选项顺序;与 Rust `GroupByCond::default` 对齐)。
 */
export function readGroupBy(v: unknown): GroupByCond | null | undefined {
  if (v === undefined || v === null) return null;
  if (!isRecord(v) || typeof v.path !== 'string') return undefined;
  if (v.dir !== undefined && v.dir !== 'asc' && v.dir !== 'desc') return undefined;
  return { path: v.path, dir: v.dir === 'desc' ? 'desc' : 'asc' };
}

/** 组内项数组:非数组 -> undefined(非法);缺失 -> 空数组;任一项形状非法 -> undefined */
function readItems(v: unknown): GroupItem[] | undefined {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return undefined;
  const out: GroupItem[] = [];
  for (const it of v) {
    if (!isRecord(it)) return undefined;
    const kind = it.kind;
    if (kind === 'keyword' || kind === 'expr') {
      if (typeof it.value !== 'string') return undefined;
      out.push({ kind, value: it.value });
    } else if (kind === 'tag' || kind === 'excludeTag') {
      if (typeof it.path !== 'string') return undefined;
      if (it.includeChildren !== undefined && typeof it.includeChildren !== 'boolean') return undefined;
      out.push({ kind, path: it.path, includeChildren: it.includeChildren === true });
    } else if (kind === 'relation' || kind === 'excludeRelation') {
      if (typeof it.path !== 'string') return undefined;
      out.push({ kind, path: it.path });
    } else if (kind === 'presence') {
      if (it.value !== 'any' && it.value !== 'none') return undefined;
      out.push({ kind: 'presence', value: it.value });
    } else {
      return undefined;
    }
  }
  return out;
}

/** 条件组数组:缺失 -> null(由平铺字段合成);非数组 -> null;任一项/项内形状非法 -> undefined */
function readGroups(v: unknown): FilterGroup[] | null | undefined {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) return null;
  const out: FilterGroup[] = [];
  for (const g of v) {
    if (!isRecord(g)) return undefined;
    if (g.op !== undefined && g.op !== 'and' && g.op !== 'or') return undefined;
    const items = readItems(g.items);
    if (items === undefined) return undefined;
    out.push({ op: g.op === 'or' ? 'or' : 'and', items });
  }
  return out;
}

/** 把任意 JSON 值规整为条件对象;结构非法返回 null(未知字段含 from/to 一律忽略) */
function normalize(data: unknown): FilterConditions | null {
  if (!isRecord(data)) return null;
  const keyword = readNullableString(data.keyword);
  const tags = readTagList(data.tags);
  const excludeTags = readTagList(data.excludeTags);
  const relations = readRelationList(data.relations ?? data.types ?? data.roles);
  const excludeRelations = readRelationList(data.excludeRelations ?? data.excludeTypes ?? data.excludeRoles);
  const presence = readNullableString(data.tagPresence);
  const sort = readNullableString(data.sort);
  const sorts = readSortList(data.sorts);
  const groupBy = readGroupBy(data.groupBy);
  const expr = readNullableString(data.expr);
  const groups = readGroups(data.groups);
  const groupOp = data.groupOp;
  if (keyword === undefined || expr === undefined) return null;
  if (tags === null || excludeTags === null || presence === undefined || sort === undefined) return null;
  if (relations === null || excludeRelations === null) return null;
  if (sorts === undefined || groups === undefined) return null;
  if (groupBy === undefined) return null;
  if (groupOp !== undefined && groupOp !== null && groupOp !== 'and' && groupOp !== 'or') return null;
  if (presence !== null && presence !== 'any' && presence !== 'none') return null;
  if (sort !== null && sort !== 'newest' && sort !== 'oldest') return null;
  const legacy: 'newest' | 'oldest' = sort === 'oldest' ? 'oldest' : 'newest';
  const sortList = sorts ?? sortsFromLegacy(legacy);
  return normalizeGroups({
    keyword: (keyword ?? '').trim() === '' ? null : keyword,
    tags,
    excludeTags,
    relations,
    excludeRelations,
    tagPresence: presence,
    sort: legacy,
    sorts: sortList.length === 0 ? sortsFromLegacy(legacy) : sortList,
    groupBy,
    expr: keepExpr(expr),
    groupOp: groupOp === 'or' ? 'or' : 'and',
    groups: groups ?? [],
  });
}

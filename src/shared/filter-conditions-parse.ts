/**
 * 持久化文本解析:filter_current 等外部来源(settings 键、Migrate 结果、IPC 入参)都要先过这里;
 * 结构非法一律回退 EMPTY_FILTER,绝不把半成品对象放进状态机。
 */
import { EMPTY_FILTER, sortsFromLegacy, validateFilter } from './filter-conditions';
import type { FilterConditions, RelationCond, SortCond, TagCond } from './filter-conditions';

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

/**
 * 应用保存视图/其它外部来源的条件时归一:与 EMPTY_FILTER 合并补齐缺字段,
 * 非法或缺失的 sort/tagPresence 回退默认 —— 防半成品对象(如 null sort)进状态机。
 * 日期范围已取消(D2):旧 JSON 里的 `from`/`to` 静默丢弃(这里只读已知字段)。
 */
export function normalizeFilter(c: Partial<FilterConditions> | null | undefined): FilterConditions {
  const rec = (c ?? {}) as Record<string, unknown>;
  return {
    keyword: c?.keyword ?? null,
    tags: Array.isArray(c?.tags) ? c.tags : [],
    excludeTags: Array.isArray(c?.excludeTags) ? c.excludeTags : [],
    relations: looseRelations(rec, ['relations', 'types', 'roles']),
    excludeRelations: looseRelations(rec, ['excludeRelations', 'excludeTypes', 'excludeRoles']),
    tagPresence: c?.tagPresence === 'any' || c?.tagPresence === 'none' ? c.tagPresence : null,
    sort: c?.sort === 'oldest' ? 'oldest' : 'newest',
    sorts: looseSorts(rec, c?.sort === 'oldest' ? 'oldest' : 'newest'),
    expr: keepExpr(c?.expr ?? null),
  };
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 空白表达式一律归一为 null(仅空判断用 trim;非空文本原样保留 —— 后端也按原文解析,
 *  这样错误位置下的字符下标与用户看到的串一致) */
const keepExpr = (v: string | null): string | null => (v === null || v.trim() === '' ? null : v);

/** 缺失/ null -> null;字符串原样;其它类型 -> undefined(非法) */
const readNullableString = (v: unknown): string | null | undefined =>
  v === undefined || v === null ? null : typeof v === 'string' ? v : undefined;

/** 关系数组:新字段优先,旧字段名 types/roles 依次回读(缺字段 -> 空数组,老库兼容);
 *  非数组或项里 path 非字符串 -> null(非法) */
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
function readSortList(v: unknown): SortCond[] | null | undefined {
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
  const expr = readNullableString(data.expr);
  if (keyword === undefined || expr === undefined) return null;
  if (tags === null || excludeTags === null || presence === undefined || sort === undefined) return null;
  if (relations === null || excludeRelations === null) return null;
  if (sorts === undefined) return null;
  if (presence !== null && presence !== 'any' && presence !== 'none') return null;
  if (sort !== null && sort !== 'newest' && sort !== 'oldest') return null;
  const legacy: 'newest' | 'oldest' = sort === 'oldest' ? 'oldest' : 'newest';
  const sortList = sorts ?? sortsFromLegacy(legacy);
  return {
    keyword: (keyword ?? '').trim() === '' ? null : keyword,
    tags,
    excludeTags,
    relations,
    excludeRelations,
    tagPresence: presence,
    sort: legacy,
    sorts: sortList.length === 0 ? sortsFromLegacy(legacy) : sortList,
    expr: keepExpr(expr),
  };
}

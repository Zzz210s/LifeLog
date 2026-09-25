/**
 * 持久化文本解析:filter_current 等外部来源(settings 键、Migrate 结果、IPC 入参)都要先过这里;
 * 结构非法一律回退 EMPTY_FILTER,绝不把半成品对象放进状态机。
 */
import { EMPTY_FILTER, validateFilter } from './filter-conditions';
import type { FilterConditions, TagCond } from './filter-conditions';

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
  return {
    keyword: c?.keyword ?? null,
    tags: Array.isArray(c?.tags) ? c.tags : [],
    excludeTags: Array.isArray(c?.excludeTags) ? c.excludeTags : [],
    tagPresence: c?.tagPresence === 'any' || c?.tagPresence === 'none' ? c.tagPresence : null,
    sort: c?.sort === 'oldest' ? 'oldest' : 'newest',
    expr: keepExpr(c?.expr ?? null),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 空白表达式一律归一为 null(仅空判断用 trim;非空文本原样保留 —— 后端也按原文解析,
 *  这样错误位置下的字符下标与用户看到的串一致) */
const keepExpr = (v: string | null): string | null => (v === null || v.trim() === '' ? null : v);

/** 缺失/ null -> null;字符串原样;其它类型 -> undefined(非法) */
const readNullableString = (v: unknown): string | null | undefined =>
  v === undefined || v === null ? null : typeof v === 'string' ? v : undefined;

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

/** 把任意 JSON 值规整为条件对象;结构非法返回 null(未知字段含 from/to 一律忽略) */
function normalize(data: unknown): FilterConditions | null {
  if (!isRecord(data)) return null;
  const keyword = readNullableString(data.keyword);
  const tags = readTagList(data.tags);
  const excludeTags = readTagList(data.excludeTags);
  const presence = readNullableString(data.tagPresence);
  const sort = readNullableString(data.sort);
  const expr = readNullableString(data.expr);
  if (keyword === undefined || expr === undefined) return null;
  if (tags === null || excludeTags === null || presence === undefined || sort === undefined) return null;
  if (presence !== null && presence !== 'any' && presence !== 'none') return null;
  if (sort !== null && sort !== 'newest' && sort !== 'oldest') return null;
  return {
    keyword: (keyword ?? '').trim() === '' ? null : keyword,
    tags,
    excludeTags,
    tagPresence: presence,
    sort: sort === 'oldest' ? 'oldest' : 'newest',
    expr: keepExpr(expr),
  };
}

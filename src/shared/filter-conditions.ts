/**
 * 结构化筛选条件(D6:真源是条件对象,不是表达式字符串)。
 * 与 Rust `db/repos/notes_filter.rs` 的 `FilterConditions` 等价,JSON 字段名 camelCase 一一对应;
 * 后端 validate 是唯一权威,本模块的 validateFilter 只做即时提示。
 */

export interface TagCond {
  /** 标签完整路径(树语义真源) */
  path: string;
  /** 含子级:按路径前缀匹配自身与全部子孙;为假时仅精确本级 */
  includeChildren: boolean;
}

export interface FilterConditions {
  keyword: string | null;
  tags: TagCond[];
  excludeTags: TagCond[];
  /** ISO 日期(YYYY-MM-DD),可只填一端 */
  from: string | null;
  to: string | null;
  tagPresence: 'any' | 'none' | null;
  sort: 'newest' | 'oldest';
}

/** 引入/排除标签条数上限(与后端 validate 一致) */
export const MAX_FILTER_TAG_ITEMS = 20;
/** 关键词长度上限(字符数) */
export const MAX_FILTER_KEYWORD_CHARS = 200;
/** 标签层级深度上限(与 tags.rs 的 MAX_DEPTH 一致) */
const MAX_TAG_DEPTH = 5;

/** 默认条件:全部笔记,最新在前 */
export const EMPTY_FILTER: FilterConditions = {
  keyword: null,
  tags: [],
  excludeTags: [],
  from: null,
  to: null,
  tagPresence: null,
  sort: 'newest',
};

/** 是否"没有收窄条件"(排序不算收窄):空条件时筛选栏隐藏芯片区 */
export function isFilterEmpty(c: FilterConditions): boolean {
  return (
    (c.keyword ?? '').trim() === '' &&
    c.tags.length === 0 &&
    c.excludeTags.length === 0 &&
    c.from === null &&
    c.to === null &&
    c.tagPresence === null
  );
}

/** 值等价键:用于 React 依赖比较(对象引用变化但值相同时不重复查询) */
export function filterKey(c: FilterConditions): string {
  return JSON.stringify([
    c.keyword ?? '',
    c.sort,
    c.tagPresence ?? '',
    c.from ?? '',
    c.to ?? '',
    c.tags.map((t) => [t.path, t.includeChildren]),
    c.excludeTags.map((t) => [t.path, t.includeChildren]),
  ]);
}

/** 单段标签名:名称字符 + 内部 `.`/`·`(须夹在名称字符之间),与后端 valid_segment 同构 */
const TAG_SEGMENT = /^[\p{L}\p{N}_-]+(?:[.·][\p{L}\p{N}_-]+)*$/u;

/** 标签路径是否合法(空段、首尾/连续斜杠、非法字符、超深一律非法) */
export function isValidTagPath(path: string): boolean {
  const parts = path.split('/');
  return parts.length <= MAX_TAG_DEPTH && parts.every((p) => TAG_SEGMENT.test(p));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO 日期格式 + 基本日历合法性(闰年 2 月按公历;年份下限 1 与 Rust y>=1 对齐) */
function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}

/** 校验条件:返回中文提示,合法返回 null(后端仍是唯一权威) */
export function validateFilter(c: FilterConditions): string | null {
  // 码点计数与 Rust chars().count() 对齐:代理对字符按 1 个字计
  if ([...(c.keyword ?? '').trim()].length > MAX_FILTER_KEYWORD_CHARS) {
    return `关键词最多 ${MAX_FILTER_KEYWORD_CHARS} 字`;
  }
  if (c.tags.length > MAX_FILTER_TAG_ITEMS) return `引入标签最多 ${MAX_FILTER_TAG_ITEMS} 项`;
  if (c.excludeTags.length > MAX_FILTER_TAG_ITEMS) return `排除标签最多 ${MAX_FILTER_TAG_ITEMS} 项`;
  for (const t of [...c.tags, ...c.excludeTags]) {
    if (!isValidTagPath(t.path)) return `标签路径不合法:${t.path}`;
  }
  if (c.from !== null && !isIsoDate(c.from)) return '开始日期格式不正确(应为 YYYY-MM-DD)';
  if (c.to !== null && !isIsoDate(c.to)) return '结束日期格式不正确(应为 YYYY-MM-DD)';
  if (c.from !== null && c.to !== null && c.from > c.to) return '开始日期不能晚于结束日期';
  if (c.sort !== 'newest' && c.sort !== 'oldest') return '排序取值非法';
  if (c.tagPresence !== null && c.tagPresence !== 'any' && c.tagPresence !== 'none') {
    return '标签有无取值非法';
  }
  return null;
}

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
 */
export function normalizeFilter(c: Partial<FilterConditions> | null | undefined): FilterConditions {
  return {
    keyword: c?.keyword ?? null,
    tags: Array.isArray(c?.tags) ? c.tags : [],
    excludeTags: Array.isArray(c?.excludeTags) ? c.excludeTags : [],
    from: c?.from ?? null,
    to: c?.to ?? null,
    tagPresence: c?.tagPresence === 'any' || c?.tagPresence === 'none' ? c.tagPresence : null,
    sort: c?.sort === 'oldest' ? 'oldest' : 'newest',
  };
}

/** 就地变更后能否本地重判:仅"引入标签全为仅本级且无排除/日期/有无标签"时成立 */
export function canEvaluateLocally(c: FilterConditions): boolean {
  return (
    c.excludeTags.length === 0 &&
    c.tagPresence === null &&
    c.from === null &&
    c.to === null &&
    c.tags.every((t) => !t.includeChildren)
  );
}

/** 本地重判:笔记是否仍满足全部"仅本级"引入标签(AND) */
export function matchesTagsByPath(note: { tags: string[] }, c: FilterConditions): boolean {
  return c.tags.every((t) => note.tags.includes(t.path));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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

/** 把任意 JSON 值规整为条件对象;结构非法返回 null */
function normalize(data: unknown): FilterConditions | null {
  if (!isRecord(data)) return null;
  const keyword = readNullableString(data.keyword);
  const from = readNullableString(data.from);
  const to = readNullableString(data.to);
  const tags = readTagList(data.tags);
  const excludeTags = readTagList(data.excludeTags);
  const presence = readNullableString(data.tagPresence);
  const sort = readNullableString(data.sort);
  if (keyword === undefined || from === undefined || to === undefined) return null;
  if (tags === null || excludeTags === null || presence === undefined || sort === undefined) return null;
  if (presence !== null && presence !== 'any' && presence !== 'none') return null;
  if (sort !== null && sort !== 'newest' && sort !== 'oldest') return null;
  return {
    keyword: (keyword ?? '').trim() === '' ? null : keyword,
    tags,
    excludeTags,
    from,
    to,
    tagPresence: presence,
    sort: sort === 'oldest' ? 'oldest' : 'newest',
  };
}

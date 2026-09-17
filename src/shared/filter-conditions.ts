/**
 * 结构化筛选条件(D6:真源是条件对象,不是表达式字符串)。
 * 与 Rust `db/repos/notes_filter.rs` 的 `FilterConditions` 等价,JSON 字段名 camelCase 一一对应;
 * 后端 validate 是唯一权威,本模块的 validateFilter 只做即时提示。
 * 解析(parse/normalize)与本地重判在 filter-conditions-parse.ts / filter-conditions-local.ts,
 * 本文件只放类型、默认值与不依赖外部输入的校验。
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
  tagPresence: 'any' | 'none' | null;
  /** 创建顺序(实现为按 `notes.id`,与 created_at 同序);旧 JSON 的同名字段语义不变 */
  sort: 'newest' | 'oldest';
  /** 高级表达式原文(spec 3.3;null=无表达式);语义校验走 IPC `validate_expr`,前端不解析 */
  expr: string | null;
}

/** 引入/排除标签条数上限(与后端 validate 一致) */
export const MAX_FILTER_TAG_ITEMS = 20;
/** 关键词长度上限(字符数) */
export const MAX_FILTER_KEYWORD_CHARS = 200;
/** 标签层级深度上限(与 tags.rs 的 MAX_DEPTH 一致) */
const MAX_TAG_DEPTH = 5;
/** 表达式长度上限(字符数,与 Rust expr::MAX_LEN 一致) */
export const MAX_EXPR_CHARS = 500;

/** 默认条件:全部笔记,最新在前 */
export const EMPTY_FILTER: FilterConditions = {
  keyword: null,
  tags: [],
  excludeTags: [],
  tagPresence: null,
  sort: 'newest',
  expr: null,
};

/** 表达式是否为空(全空白视为没有表达式,与后端 trim 口径一致) */
export function hasExpr(c: FilterConditions): boolean {
  return (c.expr ?? '').trim() !== '';
}

/** 是否"没有收窄条件"(排序不算收窄):空条件时筛选栏隐藏芯片区 */
export function isFilterEmpty(c: FilterConditions): boolean {
  return (
    (c.keyword ?? '').trim() === '' &&
    c.tags.length === 0 &&
    c.excludeTags.length === 0 &&
    c.tagPresence === null &&
    !hasExpr(c)
  );
}

/** 值等价键:用于 React 依赖比较(对象引用变化但值相同时不重复查询) */
export function filterKey(c: FilterConditions): string {
  return JSON.stringify([
    c.keyword ?? '',
    c.sort,
    c.tagPresence ?? '',
    c.tags.map((t) => [t.path, t.includeChildren]),
    c.excludeTags.map((t) => [t.path, t.includeChildren]),
    // 表达式按 trim 后的值参与比较:后端解析前也 trim,尾随空白不产生新查询
    (c.expr ?? '').trim(),
  ]);
}

/** 单段标签名:名称字符 + 内部 `.`/`·`(须夹在名称字符之间),与后端 valid_segment 同构 */
const TAG_SEGMENT = /^[\p{L}\p{N}_-]+(?:[.·][\p{L}\p{N}_-]+)*$/u;

/** 标签路径是否合法(空段、首尾/连续斜杠、非法字符、超深一律非法) */
export function isValidTagPath(path: string): boolean {
  const parts = path.split('/');
  return parts.length <= MAX_TAG_DEPTH && parts.every((p) => TAG_SEGMENT.test(p));
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
  if (c.sort !== 'newest' && c.sort !== 'oldest') return '排序取值非法';
  if (c.tagPresence !== null && c.tagPresence !== 'any' && c.tagPresence !== 'none') {
    return '标签有无取值非法';
  }
  // 与 Rust expr::MAX_LEN 同口径的本地长度检查;其余语义校验一律走 IPC(不做第二套解析器)
  if ([...(c.expr ?? '')].length > MAX_EXPR_CHARS) return `表达式最多 ${MAX_EXPR_CHARS} 字符`;
  return null;
}

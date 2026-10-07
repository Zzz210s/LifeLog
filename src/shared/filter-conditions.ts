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

/** 关系条件(原「类型条件」,设计 2026-10-06 §10 R10b):只有被指向标签的路径 ——
 *  关系天然含子级并叠加继承,无「仅本级」开关 */
export interface RelationCond {
  path: string;
}

/** 排序方向:desc = 新 -> 旧 / 选项顺序;asc = 旧 -> 新 / 选项倒序(需按维度出文案) */
export type SortDir = 'desc' | 'asc';

/** 排序条件(有序数组元素,下标即优先级):时间(notes.id)或标签轴子树(恒含子级) */
export type SortCond =
  | { kind: 'time'; dir: SortDir; enabled: boolean }
  | { kind: 'tag'; path: string; dir: SortDir; enabled: boolean };

export interface FilterConditions {
  keyword: string | null;
  tags: TagCond[];
  excludeTags: TagCond[];
  /** 关系条件(原「类型条件」,设计 2026-10-06 §10 R10b):命中 = 指向该标签的标签子树
   *  ∪ 经携带/关系继承命中;老库缺字段时按无关系解析 */
  relations: RelationCond[];
  excludeRelations: RelationCond[];
  tagPresence: 'any' | 'none' | null;
  /** 创建顺序(实现为按 `notes.id`,与 created_at 同序);**只读兼容位** ——
   *  旧构建仍按它降级;写侧由 `sorts` 派生镜像,`filterKey` 不认它(设计 D2 §4.2) */
  sort: 'newest' | 'oldest';
  /** 有序排序条件(下标 = 优先级;空数组 = 默认时间降序);旧 JSON 缺字段时由 `sort` 合成 */
  sorts: SortCond[];
  /** 高级表达式原文(spec 3.3;null=无表达式);语义校验走 IPC `validate_expr`,前端不解析 */
  expr: string | null;
}

/** 引入/排除标签条数上限(与后端 validate 一致) */
export const MAX_FILTER_TAG_ITEMS = 20;
/** 关键词长度上限(字符数) */
export const MAX_FILTER_KEYWORD_CHARS = 200;
/** 表达式长度上限(字符数,与 Rust expr::MAX_LEN 一致) */
export const MAX_EXPR_CHARS = 500;

/** 默认条件:全部笔记,最新在前 */
export const EMPTY_FILTER: FilterConditions = {
  keyword: null,
  tags: [],
  excludeTags: [],
  relations: [],
  excludeRelations: [],
  tagPresence: null,
  sort: 'newest',
  sorts: [],
  expr: null,
};

/** 排序条件条数上限(与 Rust `notes_filter::MAX_SORT_CONDS` 一致) */
export const MAX_SORT_CONDS = 5;

/**
 * 旧单值 `sort` 折算成排序数组:仅 `oldest` 携带信息(合成一条时间升序),
 * `newest` 是默认值 -> 空数组(空数组经 `effective_sorts` 语义等价于时间降序)。
 * 两侧(归一/写侧 UI 兼容位)共用,杜绝两套合成口径。
 */
export function sortsFromLegacy(sort: 'newest' | 'oldest' | null | undefined): SortCond[] {
  return sort === 'oldest' ? [{ kind: 'time', dir: 'asc', enabled: true }] : [];
}

/**
 * 衍生旧镜像(只用于降级读取与命令勾选态,不参与 `filterKey`):
 * 第一条**启用的时间条件**方向定 `sort`,没有则 `newest`(标签条件不影响它)。
 * 序列化与落态(applyFilterPatch)共用这一份口径,避免两套派生逻辑漂移。
 */
export function sortMirror(sorts: SortCond[]): 'newest' | 'oldest' {
  const first = sorts.find((s) => s.enabled && s.kind === 'time');
  return first !== undefined && first.kind === 'time' && first.dir === 'asc' ? 'oldest' : 'newest';
}

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
    c.relations.length === 0 &&
    c.excludeRelations.length === 0 &&
    c.tagPresence === null &&
    !hasExpr(c)
  );
}

/** 值等价键:用于 React 依赖比较(对象引用变化但值相同时不重复查询) */
export function filterKey(c: FilterConditions): string {
  return JSON.stringify([
    c.keyword ?? '',
    c.tagPresence ?? '',
    c.tags.map((t) => [t.path, t.includeChildren]),
    c.excludeTags.map((t) => [t.path, t.includeChildren]),
    c.relations.map((r) => r.path),
    c.excludeRelations.map((r) => r.path),
    // 排序只认 sorts(旧 sort 是写侧派生镜像,不参与比较);enabled 停用项也要参与,
    // 否则勾掉/勾回不触发重查
    c.sorts.map((s) =>
      s.kind === 'tag' ? ['tag', s.path, s.dir, s.enabled] : ['time', s.dir, s.enabled]
    ),
    // 表达式按 trim 后的值参与比较:尾随空白不触发重复查询(后端按原文解析,只把全空白视为未设置)
    (c.expr ?? '').trim(),
  ]);
}

/** 单段标签名长度上限(与 Rust `tag_label::MAX_LABEL_CHARS` 一致) */
const MAX_TAG_LABEL_CHARS = 100;
/** 名字里不允许的字符:空白(Unicode White_Space,与 Rust `char::is_whitespace` 同集)与控制字符 */
const NAME_FORBIDDEN = /[\p{White_Space}\p{Cc}]/u;

/**
 * 单段标签名是否合法(T3 界面口径,与 Rust `tag_label::validate_label` 同规则):
 * 非空、无 `/`(单段)、无空白/控制字符、无 `#`、不超长 ——
 * 段内的行内 md 符号([ ] ( ) * 等)**全部放行**(T1/T2 允许标签名含行内 md)。
 */
function isValidTagLabel(name: string): boolean {
  return (
    name !== '' &&
    !NAME_FORBIDDEN.test(name) &&
    !name.includes('#') &&
    [...name].length <= MAX_TAG_LABEL_CHARS
  );
}

/**
 * 标签路径是否合法(T3:md 友好口径,与 Rust `tags::validate_tag_path` 同规则):
 * 按 `/` 分段、每段走 isValidTagLabel(层级深度不设上限)。
 * 与正文 `#` 语法无关(那仍是严格名称字符集,前端也不镜像);
 * 共享向量 `fixtures/tag-path-valid.json` 两侧同源读。
 */
export function isValidTagPath(path: string): boolean {
  return path.split('/').every(isValidTagLabel);
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
  if (c.relations.length > MAX_FILTER_TAG_ITEMS) return `关系最多 ${MAX_FILTER_TAG_ITEMS} 项`;
  if (c.excludeRelations.length > MAX_FILTER_TAG_ITEMS) {
    return `排除关系最多 ${MAX_FILTER_TAG_ITEMS} 项`;
  }
  for (const r of [...c.relations, ...c.excludeRelations]) {
    if (!isValidTagPath(r.path)) return `标签路径不合法:${r.path}`;
  }
  if (c.sort !== 'newest' && c.sort !== 'oldest') return '排序取值非法';
  if (c.sorts.length > MAX_SORT_CONDS) return `排序条件最多 ${MAX_SORT_CONDS} 条`;
  for (const s of c.sorts) {
    if (s.dir !== 'asc' && s.dir !== 'desc') return '排序方向非法';
    if (s.kind === 'tag' && !isValidTagPath(s.path)) return `标签路径不合法:${s.path}`;
  }
  if (c.tagPresence !== null && c.tagPresence !== 'any' && c.tagPresence !== 'none') {
    return '标签有无取值非法';
  }
  // 与 Rust expr::MAX_LEN 同口径的本地长度检查;其余语义校验一律走 IPC(不做第二套解析器)
  if ([...(c.expr ?? '')].length > MAX_EXPR_CHARS) return `表达式最多 ${MAX_EXPR_CHARS} 字符`;
  return null;
}

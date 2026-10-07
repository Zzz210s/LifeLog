/**
 * 条件对象的本地即时校验(后端 `notes_filter::validate` 仍是唯一权威,这里只做即时提示)
 * 与标签路径的界面口径校验。自 `filter-conditions.ts` 拆出(守 200 行;原文件加条件组后超限)。
 * 校验一律先过 `normalizeGroups`:平铺旧字段搬进组后再逐项检查,保证「旧 JSON → 校验」与
 * 「新 JSON → 校验」同一口径。
 */
import { normalizeGroups } from './filter-groups';
import type { FilterConditions } from './filter-conditions';

/** 引入/排除标签条数上限(与后端 validate 一致) */
export const MAX_FILTER_TAG_ITEMS = 20;
/** 关键词长度上限(字符数) */
export const MAX_FILTER_KEYWORD_CHARS = 200;
/** 表达式长度上限(字符数,与 Rust expr::MAX_LEN 一致) */
export const MAX_EXPR_CHARS = 500;
/** 排序条件条数上限(与 Rust `notes_filter::MAX_SORT_CONDS` 一致) */
export const MAX_SORT_CONDS = 5;

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
  const n = normalizeGroups(c);
  let tags = 0;
  let excludeTags = 0;
  let relations = 0;
  let excludeRelations = 0;
  for (const g of n.groups) {
    for (const it of g.items) {
      if (it.kind === 'keyword') {
        // 码点计数与 Rust chars().count() 对齐:代理对字符按 1 个字计
        if ([...it.value.trim()].length > MAX_FILTER_KEYWORD_CHARS) {
          return `关键词最多 ${MAX_FILTER_KEYWORD_CHARS} 字`;
        }
      } else if (it.kind === 'tag' || it.kind === 'excludeTag') {
        if (!isValidTagPath(it.path)) return `标签路径不合法:${it.path}`;
        if (it.kind === 'tag') tags++;
        else excludeTags++;
      } else if (it.kind === 'relation' || it.kind === 'excludeRelation') {
        if (!isValidTagPath(it.path)) return `标签路径不合法:${it.path}`;
        if (it.kind === 'relation') relations++;
        else excludeRelations++;
      } else if (it.kind === 'presence') {
        if (it.value !== 'any' && it.value !== 'none') return '标签有无取值非法';
      } else if (it.kind === 'expr') {
        // 与 Rust expr::MAX_LEN 同口径的本地长度检查;语义校验走 IPC(不做第二套解析器)
        if ([...it.value].length > MAX_EXPR_CHARS) return `表达式最多 ${MAX_EXPR_CHARS} 字符`;
      }
    }
  }
  if (tags > MAX_FILTER_TAG_ITEMS) return `引入标签最多 ${MAX_FILTER_TAG_ITEMS} 项`;
  if (excludeTags > MAX_FILTER_TAG_ITEMS) return `排除标签最多 ${MAX_FILTER_TAG_ITEMS} 项`;
  if (relations > MAX_FILTER_TAG_ITEMS) return `关系最多 ${MAX_FILTER_TAG_ITEMS} 项`;
  if (excludeRelations > MAX_FILTER_TAG_ITEMS) return `排除关系最多 ${MAX_FILTER_TAG_ITEMS} 项`;
  if (n.sort !== 'newest' && n.sort !== 'oldest') return '排序取值非法';
  if (n.sorts.length > MAX_SORT_CONDS) return `排序条件最多 ${MAX_SORT_CONDS} 条`;
  for (const s of n.sorts) {
    if (s.dir !== 'asc' && s.dir !== 'desc') return '排序方向非法';
    if (s.kind === 'tag' && !isValidTagPath(s.path)) return `标签路径不合法:${s.path}`;
  }
  // 分组轴与方向(与 Rust `validate_group_by` 同口径;分组不是收窄条件,错了只会分错组)
  if (n.groupBy !== null) {
    if (n.groupBy.dir !== 'asc' && n.groupBy.dir !== 'desc') return '分组方向非法';
    if (!isValidTagPath(n.groupBy.path)) return `标签路径不合法:${n.groupBy.path}`;
  }
  return null;
}

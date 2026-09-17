/**
 * 标签页自动标题(spec 2026-09-17 S7 的纯函数):标题为空时由条件生成简短中文。
 * 规则(段顺序固定,段间用 ` · ` 连接):
 *  1. 引入标签 -> `#完整路径`;排除标签 -> `排除 #完整路径`;有无标签 -> `有标签`/`无标签`
 *  2. 关键词 -> `关键词「…」`(超长截断);表达式 -> `表达式`
 *  3. 排序段只在需要区分时追加:有标签/表达式条件时带上(`#待办 · 最新在前`),或本身就是
 *     「最早在前」;纯关键词/纯有无标签的标题保持简短(`关键词「减肥」`、`无标签`)。
 * 没有任何收窄条件 -> `全部`(空条件配最早在前 -> `全部 · 最早在前`)。
 */
import { hasExpr } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';

/** 关键词在标题里的最大字符数(超出以 … 截断;只影响标题,不影响查询) */
export const TITLE_KEYWORD_MAX = 12;

export function autoTitle(c: FilterConditions): string {
  const parts: string[] = [];
  for (const t of c.tags) parts.push('#' + t.path);
  for (const t of c.excludeTags) parts.push('排除 #' + t.path);
  if (c.tagPresence === 'none') parts.push('无标签');
  if (c.tagPresence === 'any') parts.push('有标签');
  const keyword = (c.keyword ?? '').trim();
  if (keyword !== '') parts.push('关键词「' + elide(keyword) + '」');
  if (hasExpr(c)) parts.push('表达式');
  // 结构性条件(标签/表达式)才把排序写进标题;最早在前是显式选择,任何情况都写
  const structural = c.tags.length > 0 || c.excludeTags.length > 0 || hasExpr(c);
  if (parts.length === 0) parts.push('全部');
  if (structural || c.sort === 'oldest') parts.push(c.sort === 'oldest' ? '最早在前' : '最新在前');
  return parts.join(' · ');
}

/** 按字符(码点)截断,避免把代理对字符切坏 */
function elide(text: string): string {
  const chars = [...text];
  return chars.length <= TITLE_KEYWORD_MAX
    ? text
    : chars.slice(0, TITLE_KEYWORD_MAX).join('') + '…';
}

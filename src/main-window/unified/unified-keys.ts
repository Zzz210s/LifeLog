/**
 * 统一输入框的按键 -> 动作(纯函数;计划 Task 5)。
 *
 * 与浮层的 `resolveKeyAction` 同口径,只是多两条本框特有的语义:
 *  - `Ctrl+Enter` **永远**保存(下拉开着也一样,浮层那侧是"忽略"交给别人);
 *  - `Tab` = 采纳(不让焦点跑出输入框),不是浮层的"关闭"。
 * 顺序即优先级:保存 -> Esc -> (没下拉就放行给光标) -> 移动 -> Tab -> Enter(有行才采纳)。
 * 取模复用浮层的 `wrapIndex`(边界循环,空列表恒 0),不另写一套。
 */
import { wrapIndex } from '../palette/palette-keydown';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
}

export interface UnifiedKeyContext {
  /** 下拉是否真的在场(记录/筛选模式或浮层开着时为假 -> 所有候选键都放行) */
  dropdownShown: boolean;
  activeIndex: number;
  /** 候选行数 */
  count: number;
}

export type UnifiedKeyAction =
  | { type: 'save' }
  | { type: 'esc' }
  | { type: 'highlight'; index: number }
  | { type: 'accept'; index: number }
  | { type: 'ignore' };

export function routeUnifiedKey(e: KeyLike, ctx: UnifiedKeyContext): UnifiedKeyAction {
  if (e.ctrlKey && e.key === 'Enter') return { type: 'save' };
  if (e.key === 'Escape') return { type: 'esc' };
  if (!ctx.dropdownShown) return { type: 'ignore' };
  if (e.key === 'ArrowDown') return { type: 'highlight', index: wrapIndex(ctx.activeIndex, 1, ctx.count) };
  if (e.key === 'ArrowUp') return { type: 'highlight', index: wrapIndex(ctx.activeIndex, -1, ctx.count) };
  if (e.key === 'Tab') return { type: 'accept', index: ctx.activeIndex };
  if (e.key === 'Enter' && ctx.count > 0) return { type: 'accept', index: ctx.activeIndex };
  return { type: 'ignore' };
}

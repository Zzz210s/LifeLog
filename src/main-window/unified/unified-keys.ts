/**
 * 统一输入框的按键 -> 动作(纯函数;计划 Task 5)。
 *
 * 与浮层的 `resolveKeyAction` 同口径,只是多两条本框特有的语义:
 *  - `Ctrl+Enter` **永远**保存(下拉开着也一样,浮层那侧是"忽略"交给别人);
 *  - `Tab` = 采纳(不让焦点跑出输入框),不是浮层的"关闭";零候选时不采纳(与 Enter 同守卫,
 *    否则调用方按索引取行会拿到 undefined)。
 * 顺序即优先级:输入法组合守卫 -> 保存 -> Esc -> (没下拉就放行给光标) -> 移动 -> Tab -> Enter(有行才采纳)。
 * 取模复用浮层的 `wrapIndex`(边界循环,空列表恒 0),不另写一套。
 */
import { wrapIndex } from '../palette/palette-keydown';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  /** 输入法组合中(React 侧取 e.nativeEvent.isComposing) */
  isComposing?: boolean;
  /** 只给 keyCode 的输入法形态(229,与浮层 use-palette 同口径) */
  keyCode?: number;
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
  // 输入法组合守卫(审查 C1):中文候选开着时,上屏那一下的 Enter 不能当成「采纳当前行」
  // (会误加筛选条件/误滚到某条笔记/误执行命令),Ctrl+Enter 保存同理。一律返回未消费,
  // 让按键落到 textarea 自己处理。与 use-palette.ts:146 同口径。
  if (e.isComposing === true || e.keyCode === 229) return { type: 'ignore' };
  if (e.ctrlKey && e.key === 'Enter') return { type: 'save' };
  if (e.key === 'Escape') return { type: 'esc' };
  if (!ctx.dropdownShown) return { type: 'ignore' };
  if (e.key === 'ArrowDown') return { type: 'highlight', index: wrapIndex(ctx.activeIndex, 1, ctx.count) };
  if (e.key === 'ArrowUp') return { type: 'highlight', index: wrapIndex(ctx.activeIndex, -1, ctx.count) };
  if (e.key === 'Tab' && ctx.count > 0) return { type: 'accept', index: ctx.activeIndex };
  if (e.key === 'Enter' && ctx.count > 0) return { type: 'accept', index: ctx.activeIndex };
  return { type: 'ignore' };
}

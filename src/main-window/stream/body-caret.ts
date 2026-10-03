/**
 * 点正文 -> 进编辑时的**光标落点**(用户 2026-10-03:光标要跟随点击位置,不是跑到末尾)。
 *
 * 分工:本模块只做「DOM 点击 -> (第几个顶层块, 块内第几个可见字符)」这一步;
 * 换算成源码偏移交给 `editor/click-caret.ts`(它用 markdown-it 的顶层 token 拿块的行范围)。
 * 顶层块 = `.md-body` 的直接子元素,与 markdown-it 的顶层 token 一一对应。
 */
import { sourceOffsetForClick } from '../editor/click-caret';
import { visibleOffsetAtPoint } from './caret-at-point';

/** 正文容器里承载点击的**顶层块**(不是被点到的内层元素) */
export function topLevelBlock(body: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const children = [...body.children];
  return (children.find((c) => c === target || c.contains(target)) as HTMLElement | undefined) ?? null;
}

/** 点正文某处 -> 源码偏移;算不出(不在正文里 / 量不到字符 / 块对不上)返回 null,调用方退回末尾 */
export function caretHintFromClick(
  body: HTMLElement | null,
  target: EventTarget | null,
  x: number,
  y: number,
  source: string,
): number | null {
  if (!body) return null;
  const block = topLevelBlock(body, target);
  if (!block) return null;
  const index = [...body.children].indexOf(block);
  if (index < 0) return null;
  const visible = visibleOffsetAtPoint(block, x, y);
  if (visible === null) return null;
  return sourceOffsetForClick(source, index, visible);
}

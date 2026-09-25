export interface Rect { top: number; left: number; width: number; height: number }

const HOLE_PAD = 4;
const GAP = 8;
const EDGE = 8;

/** 洞口 = 目标矩形外扩 4px(覆盖层留出呼吸感,不至于贴着控件边缘) */
export function holeRect(target: Rect, pad = HOLE_PAD): Rect {
  return { top: target.top - pad, left: target.left - pad, width: target.width + pad * 2, height: target.height + pad * 2 };
}

/** 气泡优先贴洞口下方居中;下方不够翻到上方;左右钳在视口内 8px */
export function placeBubble(
  hole: Rect,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = GAP
): { top: number; left: number } {
  const below = hole.top + hole.height + gap;
  const above = hole.top - gap - bubble.height;
  const fits = below + bubble.height + EDGE <= viewport.height;
  const top = fits ? Math.max(EDGE, below) : Math.max(EDGE, above);
  const centered = hole.left + hole.width / 2 - bubble.width / 2;
  const left = Math.min(Math.max(EDGE, centered), Math.max(EDGE, viewport.width - EDGE - bubble.width));
  return { top, left };
}

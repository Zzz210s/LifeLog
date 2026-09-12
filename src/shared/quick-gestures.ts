// 窗口最外 band 像素(CSS 像素)判定与按下序列判定,供拖动带复用。
// 不依赖 offsetX/offsetY:子元素会影响那对值,故统一用 clientX/clientY + 元素包围盒。

/** isInDragBand 的默认 band(仅单测用;生产调用点 use-drag-band 一律显式传换算后的 CSS 值)。
 * 与 quick-geometry 的 EDGE_BAND_LOGICAL(8 逻辑像素)同数值但**单位不同**,勿直接互换 */
export const DRAG_BAND = 8;

export function isInDragBand(
  x: number,
  y: number,
  w: number,
  h: number,
  band: number = DRAG_BAND,
): boolean {
  return x < band || y < band || x >= w - band || y >= h - band;
}

/** 滚轮让位给「内容滚动」所需的溢出容差(CSS 像素) */
export const SCROLL_OVERFLOW_TOLERANCE_PX = 2;

/**
 * 容器是否真的可滚动(滚轮该让位给内容):溢出量必须超过容差。
 * 快捷窗的输入框撑满窗口、高度由窗口侧换算,窗口物理尺寸与 CSS 空间来回取整会留下
 * 不到 1 像素的残差,使 scrollHeight 恰好略大于 clientHeight;若只判 `> 0`,
 * 鼠标只要停在输入框上就永远走「内容优先」分支,空输入时的滚轮缩放完全失效
 * (只剩最外 14 像素内边距环能缩放)。故这里留 2 像素容差。
 */
export function hasScrollOverflow(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight > SCROLL_OVERFLOW_TOLERANCE_PX;
}

export type PressKind = 'drag' | 'double';

// 双击必须在 mousedown 阶段用 detail 判定:原生拖动会吞掉后续 dblclick。
// detail >= 2 一律算双击,使三击的第三次按下不再启动拖动(与「双击即动作」的意图一致)。
export function pressKind(detail: number): PressKind {
  return detail >= 2 ? 'double' : 'drag';
}

// 窗口最外 band 像素判定与按下序列判定,供拖动带复用。
// 不依赖 offsetX/offsetY:子元素会影响那对值,故统一用 clientX/clientY + 元素包围盒。

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

export type PressKind = 'drag' | 'double';

// 双击必须在 mousedown 阶段用 detail 判定:原生拖动会吞掉后续 dblclick。
export function pressKind(detail: number): PressKind {
  return detail === 2 ? 'double' : 'drag';
}

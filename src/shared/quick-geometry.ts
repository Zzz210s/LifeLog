// 快捷窗几何的纯函数:宽度钳制、行数钳制、按行高算高度、左右边缘判定。
// 单位说明:全部为「逻辑像素」(与 Rust set_quick_size 命令同一单位);
// 光晕内边距 GLOW_PAD 与 Rust quick_scale 的 MIN_HEIGHT/MAX_HEIGHT 推导同源(见其常量注释)。

export const MIN_WIDTH = 240;
export const MAX_WIDTH = 900;
export const GLOW_PAD = 14;

export const MIN_LINES = 1;
export const MAX_LINES = 5;

/** 左右边缘拖动带宽度(与 quick-gestures 的 DRAG_BAND 语义一致) */
export const EDGE_BAND = 8;

export function clampWidth(w: number): number {
  // NaN 取不到方向,回退下限;+/-Infinity 经 Math.round + Math.max/min 自然落到上/下限
  if (Number.isNaN(w)) return MIN_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));
}

export function clampLines(lines: number): number {
  if (!Number.isFinite(lines)) return MIN_LINES;
  return Math.min(MAX_LINES, Math.max(MIN_LINES, Math.round(lines)));
}

/** 内容高度(不含光晕内边距) */
export function heightForLines(lines: number, lineHeight: number): number {
  return lines * lineHeight;
}

export type Side = 'left' | 'right';

/**
 * 判断按下点落在哪条竖向边缘带内;内部返回 null。
 * 窄窗口(宽度不足 2 x band)时左右带重叠,退回左带,避免同一次按下被两套逻辑争抢。
 */
export function edgeSide(x: number, width: number, band: number = EDGE_BAND): Side | null {
  if (x < band) return 'left';
  if (x >= width - band) return 'right';
  return null;
}

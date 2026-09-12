// 输入栏几何的纯函数:宽度钳制、行数钳制、按行高算高度、左右边缘判定。
// 单位表(换算靠 input-bar/logical-size.ts 的 ratio = 逻辑像素 / CSS 像素,勿混用):
// - 逻辑像素:MIN_WIDTH / MAX_WIDTH(宽度区间)、EDGE_BAND_LOGICAL(边缘热区),
//   与 Rust set_input_size / input_scale 同一单位;
// - CSS 像素:GLOW_PAD(光晕内边距环),与 Rust input_scale 的 MIN_HEIGHT/MAX_HEIGHT 推导同源。

export const MIN_WIDTH = 240;
export const MAX_WIDTH = 900;
export const GLOW_PAD = 14;

export const MIN_LINES = 1;
export const MAX_LINES = 5;

/** 边缘热区宽度(**逻辑像素**):热区随 webview 缩放同比放大,0.5-2.0 缩放下手感一致 */
export const EDGE_BAND_LOGICAL = 8;

/**
 * 逻辑像素热区 -> CSS 像素:ratio = 逻辑像素 / CSS 像素(见 input-bar/logical-size.ts)。
 * 缩放 0.5 时热区 16 CSS px、缩放 2.0 时 4 CSS px;ratio 非法(0/NaN/负数)按 1 处理。
 */
export function edgeBandCss(ratio: number): number {
  return EDGE_BAND_LOGICAL / (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
}

/**
 * 移动窗口的拖动带 CSS 宽度 = 光晕内边距环 GLOW_PAD 与「8 逻辑像素热区」取较大者:
 * 低缩放(ratio 0.5)时 8 逻辑像素 = 16 CSS px,比环还宽,取大者才保住逻辑热区;
 * 高缩放时环本身已覆盖 8 逻辑像素,取环即可(不把既有可拖动环缩窄)。
 * 取 max 而非纯换算:纯换算会在高缩放下把「整圈 14 CSS px 可拖」缩到 4 px,属能力回归;
 * **控制端已裁决保留**(详见 use-drag-band 头注释)。
 */
export function dragBandCss(ratio: number): number {
  return Math.max(GLOW_PAD, edgeBandCss(ratio));
}

export function clampWidth(w: number): number {
  // 上限 900 只是硬区间:落到窗口时 Rust 侧再与当前显示器工作区的 80% 取较小者,
  // 两者冲突时以 80% 为准(顺序:先钳 240-900,再钳工作区;见 input_scale::apply_scale)。
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
 * 判断按下点落在哪条竖向边缘带内;内部返回 null。band 是 **CSS 像素**(调用方用
 * edgeBandCss(ratio) 换算),必须显式传入:不再提供默认值,避免与 EDGE_BAND_LOGICAL
 * 的同值常量漂移。
 * 窄窗口(宽度不足 2 x band)时左右带重叠,退回左带,避免同一次按下被两套逻辑争抢。
 */
export function edgeSide(x: number, width: number, band: number): Side | null {
  if (x < band) return 'left';
  if (x >= width - band) return 'right';
  return null;
}

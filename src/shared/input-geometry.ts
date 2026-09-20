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

/**
 * # 补全建议列表的尺寸(浏览器搜索框下方那种推荐列表):
 * 列表在**窗口内**占独立高度 —— 窗口随列表展开而变高、关闭再缩回去,
 * 于是它看起来就在输入框正下方,而不是被压在小小弹窗里。
 * 行高与 TagCompleteList 的 py-1 + text-xs 对齐(24 CSS px),面板自身上下各 4px 内边距。
 */
export const SUGGEST_ROW_CSS = 24;
export const SUGGEST_PAD_CSS = 8;
/** 建议列表最多显示几行(与 tag-complete 的 COMPLETE_LIMIT 同值;超出时列表内部滚动) */
export const SUGGEST_MAX_ROWS = 8;

/** 建议列表占的 CSS 高度:0 条时为 0(窗口不加高),超过上限则内部滚动 */
export function suggestListHeightCss(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const rows = Math.min(Math.floor(count), SUGGEST_MAX_ROWS);
  return rows * SUGGEST_ROW_CSS + SUGGEST_PAD_CSS;
}

/** 边缘热区宽度(**逻辑像素**):热区随 webview 缩放同比放大,0.5-2.0 缩放下手感一致 */
export const EDGE_BAND_LOGICAL = 8;

/**
 * 拖动带向可见卡片内延伸的宽度(**CSS 像素**):输入框自带内边距环是 px-3/px-2(12/8 CSS px),
 * 取 6 保证整圈都不碰到文字(文字从 GLOW_PAD+8 处开始),同时让"抓看得见的边缘"能拖。
 */
export const CARD_DRAG_INSET_CSS = 6;

/**
 * 逻辑像素热区 -> CSS 像素:ratio = 逻辑像素 / CSS 像素(见 input-bar/logical-size.ts)。
 * 缩放 0.5 时热区 16 CSS px、缩放 2.0 时 4 CSS px;ratio 非法(0/NaN/负数)按 1 处理。
 */
export function edgeBandCss(ratio: number): number {
  return EDGE_BAND_LOGICAL / (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
}

/**
 * 移动窗口的拖动带 CSS 宽度 = 光晕内边距环 GLOW_PAD + 可见卡片内侧的一小段(见 CARD_DRAG_INSET_CSS)。
 * 只取光晕环会留下一个坑:可见卡片的边缘恰好落在 GLOW_PAD 上,用户去抓看得见的输入框边缘时
 * 会差 1 像素判不进热区(实测 110% 缩放下卡片边缘在 14 CSS px 处),手感就是"拖不动"。
 * 与「8 逻辑像素热区」取较大者:0.5-2.0 缩放下 20 CSS px = 10-40 逻辑像素,已覆盖该下限,
 * max 只作为缩放超出区间时的兜底(纯换算会在高缩放下把手感缩没)。
 */
export function dragBandCss(ratio: number): number {
  return Math.max(GLOW_PAD + CARD_DRAG_INSET_CSS, edgeBandCss(ratio));
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

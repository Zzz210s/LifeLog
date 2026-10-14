// 输入栏几何的纯函数:宽度钳制、行数钳制、按行高算高度、左右边缘判定。
// 单位表(换算靠 input-bar/logical-size.ts 的 ratio = 逻辑像素 / CSS 像素,勿混用):
// - 逻辑像素:MIN_WIDTH / MAX_WIDTH(宽度区间)、EDGE_BAND_LOGICAL(边缘热区),
//   与 Rust set_input_size 的宽度入参同一单位;
// - 基础逻辑像素(缩放 1 时的逻辑像素,页面上等于 CSS 像素):heightForLines 等高度函数,
//   与 Rust set_input_height 的入参同一单位 —— 高度不带缩放因子(缩放只乘在落窗口的物理尺寸上);
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
/** 建议列表最多显示几行。与 tag-complete 的 COMPLETE_LIMIT 同值 —— 两条上限相等意味着
 *  列表内容高度永不高于自身 max-height,即**不需要内部滚动**(R5-1:列表现不声明 overflow,
 *  落在列表上的滚轮按既有 spec 继续缩放输入栏);两值一旦漂移,列表就会变成“有滚动条却滚不动”。 */
export const SUGGEST_MAX_ROWS = 8;

/** 建议列表占的 CSS 高度:0 条时为 0(窗口不加高),超过上限按上限(候选本身也被限在同值条数) */
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
 * **只作换算用,不直接当热区**:它以屏幕空间为准,够不着页面空间里的可见卡片边缘,
 * 拖动热区一律走 cardEdgeBandCss。
 */
export function edgeBandCss(ratio: number): number {
  return EDGE_BAND_LOGICAL / (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
}

/**
 * **可见卡片边缘带**的 CSS 宽度 = 光晕内边距环 GLOW_PAD + 可见卡片内侧的一小段(见
 * CARD_DRAG_INSET_CSS)。**上下带(移动窗口)与左右带(改宽度)共用同一个带** —— 两者的目标
 * 都是「用户看得见的那圈卡片边缘」,而这圈边缘在页面空间里恒在 GLOW_PAD(14 CSS px)处。
 *
 * 为什么不能直接用「8 逻辑像素热区」(edgeBandCss):它是**屏幕空间**常量(物理宽度 = 8 x 系统
 * 缩放,不随缩放变),而可见边缘是**页面空间**常量(物理宽度 = 14 x 系统缩放 x 缩放)。
 * 两者只在缩放 ~0.57 时重合:缩放 >= 0.57 后热区整条都落在光晕环**内侧之外**,
 * 用户去抓看得见的卡片边缘就判不进热区 —— 实测 2026-10-14 装机版 zoom 1.0 抓可见边缘
 * 按下并拖动,窗口被**移动**了 100 物理像素而宽度一点没变(zoom 2.0 同样);
 * 缩放 0.5 时热区(10 物理 px)也只比可见边缘(8.75 物理 px)多出 1.25 物理像素的余量,
 * 往里偏 2 像素就落到「移动窗口」上,手感就是"宽度调不了"。
 * 取 GLOW_PAD 起算并含内侧一小段,才能保证「抓看得见的边缘」在 0.5-2.0 缩放下都判得进;
 * 与 8 逻辑像素热区取较大者:20 CSS px >= 10-40 逻辑像素,0.5-2.0 内恒为该下限所覆盖,
 * max 只作为缩放超出区间时的兜底(纯换算会在高缩放下把手感缩没)。
 * 内侧那 6 CSS px 不会碰到文字:输入框自带内边距 px-3/px-2(12/8 CSS px),文字从 GLOW_PAD+12 处开始。
 */
export function cardEdgeBandCss(ratio: number): number {
  return Math.max(GLOW_PAD + CARD_DRAG_INSET_CSS, edgeBandCss(ratio));
}

export function clampWidth(w: number): number {
  // 上限 900 只是硬区间:落到窗口时 Rust 侧再与当前显示器工作区的 80% 取较小者,
  // 两者冲突时以 80% 为准(顺序:先钳 240-900,再钳工作区;见 input_scale::apply_scale)。
  // NaN 取不到方向,回退下限;+/-Infinity 经 Math.round + Math.max/min 自然落到上/下限
  if (Number.isNaN(w)) return MIN_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));
}

/**
 * 宽度拖动的钳制:基线落在硬区间外时,把区间向外抬到基线,保证拖动**连续**。
 * 基线 = 按下那一刻的当前逻辑宽(拖动位移就在这个单位上累加),它可能是区间外的值:
 * 缩放路径按工作区 80% 收口、**不套** 240-900(见 input_scale::apply_scale 的 intent_base=None),
 * 于是放大后逻辑宽可以超过 MAX_WIDTH(2026-10-14 实测 zoom 2.0 装机版:input_w 1100 落到
 * 1536 物理像素 = 1228 逻辑宽)、缩小后可以低于 MIN_WIDTH。
 * 用硬区间钳结果就会让鼠标一动宽度跳到区间边界 —— 同一实测里,左边缘只需拖进 8 步共 20 物理
 * 像素,宽度就从 1536 跳到 1125 物理像素(左边缘瞬移 411 物理像素),用户看到的就是"宽度又跳了"。
 * 抬区间后:基线在区间外时只能朝区间内连续移动(往外拖不动),一旦进入 240-900,硬区间照常生效。
 */
export function clampWidthFrom(base: number, w: number): number {
  const b = Number.isFinite(base) ? Math.round(base) : MIN_WIDTH;
  if (b >= MIN_WIDTH && b <= MAX_WIDTH) return clampWidth(w);
  if (Number.isNaN(w)) return b; // 位移取不到方向:停在基线,不跳
  const lo = Math.min(MIN_WIDTH, b);
  const hi = Math.max(MAX_WIDTH, b);
  if (!Number.isFinite(w)) return w > 0 ? hi : lo;
  return Math.min(hi, Math.max(lo, Math.round(w)));
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
 * cardEdgeBandCss(ratio) 换算),必须显式传入:不再提供默认值,避免与 EDGE_BAND_LOGICAL
 * 的同值常量漂移。
 * 窄窗口(宽度不足 2 x band)时左右带重叠,退回左带,避免同一次按下被两套逻辑争抢。
 */
export function edgeSide(x: number, width: number, band: number): Side | null {
  if (x < band) return 'left';
  if (x >= width - band) return 'right';
  return null;
}

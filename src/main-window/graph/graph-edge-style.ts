/**
 * 边的视觉口径(2026-10-06 重做):线型间距与不透明度两件事的真源。
 *
 * 单独一份,让**绘制计划**(`planEdges` 要给同轴边写满不透明)与**画布**(`strokeAll`
 * 要拿层基础值/层弱化值)共用同一组数字 —— 否则两边各写一份,改一处漏一处。
 * 颜色不在这里:轴色来自节点根轴令牌(`--color-graph-N`)、中性色与 accent 由画布现读令牌。
 */

/** 节点圆点与关系备注的弱化透明度(边另有更细分档:非轴色 15% / 轴色 25%) */
export const DIM_ALPHA = 0.2;
/** 非轴色边(共现 / 笔记链接 / 标签关系)弱化后的不透明度(设计:其余降到约 15%) */
export const EDGE_DIM_ALPHA = 0.15;
/** 轴色(父子)边弱化后的不透明度(设计:轴色边降到约 25%) */
export const AXIS_DIM_ALPHA = 0.25;
/** 同轴边在悬停/选中时的满不透明读数(计划层写进 `Segment.alpha`) */
export const AXIS_HOT_ALPHA = 1;

/** 共现(弱关联)边基础不透明度:2026-10-06 由 0.5 提到 0.65(用户要它更亮)*/
export const CO_ALPHA = 0.65;
/** 父子(轴色)边基础不透明度:设计要它比节点淡,约 70% */
export const TREE_ALPHA = 0.7;

/** 共现边虚线间距(屏幕像素):6 实 3 空(2026-10-06 由 4/4 加长,线段更易读) */
export const CO_DASH: readonly number[] = [6, 3];
/** 笔记链接边点线间距(屏幕像素):1 实 4 空 */
export const LINK_DASH: readonly number[] = [1, 4];
/** 实线:画布层用它显式复位 `setLineDash` */
export const SOLID_DASH: readonly number[] = [];

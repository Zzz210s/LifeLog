/**
 * `drawPlan` 的尺寸口径(自 `graph-draw-plan.ts` 抽出):半径换算与 LOD 阈值。
 * 纯常数与算式,不碰节点列表;`radiusOf` 另被命中检测与展开层复用,故单独成文件。
 */

/**
 * 聚合圆的半径(设计 D1 返工,2026-10-04 截图复核):普通节点的 `radiusOf` 最大 9px,
 * 拿它画聚合圆会让 11px 的计数文字比圆还大、糊成一团。聚合圆按 `sqrt(count)` 增长,
 * 下限 12(能容纳数字)、上限 30(再大就喧宾夺主)。
 */
export function aggregateRadius(count: number): number {
  const c = Math.max(1, count);
  return Math.min(30, Math.max(12, 12 + Math.sqrt(c) * 2));
}

/**
 * 枢纽**外环**的判据(设计 D6,2026-10-04 二次复核):用**度数**(父子边 + 共现边之和),
 * 不用 `selfCount`。
 *
 * 为什么换:`selfCount` 是"本级直接挂的笔记数",靠子级撑起来的骨架节点(如 `书籍`)本级很小,
 * 永远不带环 —— 实测阈值降到 30 仍然一个都看不见。度数才对应"这个节点连出去多少关系",
 * 也正是画布上能一眼看出重要性差异的量。
 */
export const HUB_RING_DEGREE = 10;

/** LOD 中档(hubs)显示文字的阈值。口径是**本级**计数(2026-10-01 改):`notes` 是含子级,
 *  展开时间轴后 `时间/日期/2026/03/28` 这类末级段名会靠祖先的计数抢到文字;`selfCount` 才是
 *  "这个标签本身装了多少东西",用它文字才落在真正的枢纽上(设计 §3.2 的枢纽判据)。 */
export const HUB_NOTES = 100;

/**
 * 关系边备注文字的最低缩放(设计 §8):低缩放只画箭头不画字 —— 备注是「这条边什么意思」的
 * 补充信息,缩小时把 24 条备注一起画出来会把骨架糊住;箭头方向本身在小比例下就够读。
 */
export const RELATION_REMARK_MIN_K = 1.2;

/**
 * 关系边箭头尖离目标圆心的回收余量(屏幕像素):实际回收 = **目标圆半径 + 这个余量**。
 * 写死常量不行 —— `radiusOf` 上限 9、聚合圆可到 30,固定 10px 会让大圆的箭头体落在圆内被点盖掉。
 */
export const ARROW_RETREAT_GAP = 6;

/**
 * 关系备注沿箭头**法线**错开的距离(屏幕像素):摆在箭头正上方会被那根线和两端节点压住,
 * 错开后配合底衷胶囊才从标签堆里分离得出来。
 */
export const RELATION_REMARK_OFFSET = 9;
const MIN_R = 2.5;
const MAX_R = 9;

/**
 * 点半径:随笔记数开方增长,撞上限即封顶(1177 条笔记也已到顶)。
 * 导出给命中检测(`graph-hit.ts`)复用 —— 一处定义,两处使用。
 */
export function radiusOf(notes: number): number {
  return Math.min(MAX_R, MIN_R + Math.sqrt(Math.max(notes, 0)) / 4);
}

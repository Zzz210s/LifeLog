/**
 * 标签行的**几何**常量与纯函数(2026-10-16 从 `TagRow` 拆出,让行组件在 200 行内腾出行数):
 * 左内边距、缩进导轨宽度。两者都被"行"与"插入线"共用,必须同源,所以放在一处而不是各算一份。
 */
import type { TagNode } from './tag-tree';

/** 行的左内边距 = 同级插入线的左端(扁平 6、树 6 + (depth-1)*12),两处必须同源 */
export function lineIndent(node: TagNode, flat: boolean): number {
  return flat ? 6 : 6 + (node.depth - 1) * 12;
}

/**
 * 缩进导轨宽度(视觉刷新 V5,设计 §4-8):每级 1px 竖线画在缩进区内(x = 6 + k*12)。
 * 第 2 层起每多一层多一条线,宽度 = 最后一条线的位置相对首条线的偏移 + 1px(首条在缩进区起点)。
 * main.css 的 .tag-guides 用这个宽度裁切那条 repeating-linear-gradient,因此不需要额外 DOM 节点。
 */
export function guideWidth(depth: number, flat: boolean): number {
  return flat || depth < 2 ? 0 : 1 + (depth - 2) * 12;
}

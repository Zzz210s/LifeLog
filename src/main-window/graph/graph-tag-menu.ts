/**
 * 关系图节点 -> 侧栏标签菜单(`TagMenu`)所需形状的适配器(G2 Task 5)。
 *
 * 菜单只吃 `ManagedNode` + 全部 `TagCount` 行:id/path/name/depth/sortOrder/selfCount/subtreeCount
 * 逐字映射;`children` 只用于合并面板的「有子标签」警告 —— 图数据不携带层级数组,故给空数组
 * (候选剔除走 `mergeCandidates` 的路径前缀,不吃 `children`)。
 */
import type { GraphNode, TagCount } from '../../shared/types';
import type { ManagedNode } from '../sidebar/tag-tree';

/** 图节点当标签树节点用:name 取末级段(与 tag-tree 的 makeNode 同口径) */
export function toManagedNode(n: GraphNode): ManagedNode {
  return {
    id: n.id,
    path: n.path,
    name: n.path.slice(n.path.lastIndexOf('/') + 1),
    depth: n.depth,
    sortOrder: n.sortOrder,
    selfCount: n.selfCount,
    subtreeCount: n.notes,
    children: [],
  };
}

/** 图节点当标签行用:`TagCount` 是后端口径(snake_case),这里逐字对齐 */
export function toTagCount(n: GraphNode): TagCount {
  return {
    id: n.id,
    path: n.path,
    depth: n.depth,
    sort_order: n.sortOrder,
    self_count: n.selfCount,
    subtree_count: n.notes,
  };
}

/**
 * 菜单落点钳到视口内:菜单宽 224(`w-56`)+ 8 边距、最高 320(`max-h-80`)+ 8。
 * 与侧栏 `TagsSection` 同一口径 —— 不钳的话贴着右/下边右键会让菜单溢出屏幕。
 * `vw` / `vh` 由调用方给(`window.innerWidth` / `innerHeight`),便于纯函数测试。
 */
export function clampMenuPos(
  x: number,
  y: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  return { x: Math.max(8, Math.min(x, vw - 232)), y: Math.max(8, Math.min(y, vh - 328)) };
}

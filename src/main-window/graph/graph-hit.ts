import type { GraphNode } from '../../shared/types';
import { screenOf, type Camera } from './graph-camera';
import { radiusOf } from './graph-draw-plan';
import type { Point } from './radial';

/** 命中容差(屏幕像素):点比看起来好点一些,手指/触控板也不至于难点 */
export const HIT_SLOP = 4;

/**
 * 屏幕坐标 -> 命中的节点 id。
 * 触及范围 = 画出来的半径(随笔记数增长,见 `radiusOf`)× 缩放 k + `HIT_SLOP`,
 * 因此容差是**屏幕像素**:缩小时点变小,容差不会跟着缩水。
 * 多个命中取屏幕上最近的一个;都不中返回 null。
 */
export function hitTest(input: {
  nodes: readonly GraphNode[];
  points: Map<number, Point>;
  cam: Camera;
  x: number;
  y: number;
}): number | null {
  const { nodes, points, cam, x, y } = input;
  let best: { id: number; d: number } | null = null;
  for (const n of nodes) {
    const p = points.get(n.id);
    if (!p) continue; // 布局没覆盖这个点(等价于画不出来,也就点不中)
    const s = screenOf(p, cam);
    const d = Math.hypot(s.x - x, s.y - y);
    const reach = radiusOf(n.notes) * cam.k + HIT_SLOP;
    if (d > reach) continue;
    if (best === null || d < best.d) best = { id: n.id, d };
  }
  return best === null ? null : best.id;
}

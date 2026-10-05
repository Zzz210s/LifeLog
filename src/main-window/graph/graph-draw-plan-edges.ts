/**
 * `drawPlan` 的边层(自 `graph-draw-plan.ts` 抽出):把标签树的共现/父子边折成屏幕线段。
 * 纯几何 —— 是否可见、是否弱化/加粗都在这里定,颜色交给画布的边档令牌。
 */
import type { GraphEdge } from '../../shared/types';
import { screenOf, type Camera } from './graph-camera';
import { isDimmed, type Emphasis } from './graph-focus';
import type { Point } from './radial';
import type { Segment } from './graph-draw-plan-types';

/**
 * 边:至少一端在视口内才画(两端都在视口外的一律丢弃,见设计 §3.2);
 * 只要有一端暗,这条边就暗(边是自己画不亮的,一端进了暗处就跟着暗)。
 */
export function planEdges(input: {
  edges: readonly GraphEdge[];
  points: Map<number, Point>;
  cam: Camera;
  visible: ReadonlySet<number>;
  emphasis: Emphasis;
}): { co: Segment[]; tree: Segment[] } {
  const { edges, points, cam, visible, emphasis } = input;
  const co: Segment[] = [];
  const tree: Segment[] = [];
  for (const e of edges) {
    const pa = points.get(e.a);
    const pb = points.get(e.b);
    if (!pa || !pb) continue; // 位置未知的边不画(布局未覆盖该点)
    if (!visible.has(e.a) && !visible.has(e.b)) continue;
    const a = screenOf(pa, cam);
    const b = screenOf(pb, cam);
    const seg: Segment = {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      weight: e.weight,
      emphasized: e.a === emphasis.active || e.b === emphasis.active,
      dim: isDimmed(e.a, emphasis) || isDimmed(e.b, emphasis),
    };
    if (e.kind === 'tree') tree.push(seg);
    else co.push(seg);
  }
  return { co, tree };
}

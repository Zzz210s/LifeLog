/**
 * `drawPlan` 的边层(自 `graph-draw-plan.ts` 抽出):把标签树的共现/父子边折成屏幕线段。
 * 纯几何 —— 是否可见、是否弱化/加粗都在这里定;**父子边另带父节点根轴色与同轴强调读数**。
 *
 * 2026-10-06 边视觉重做:`tree_edges` 的 `a = parent_id`,所以父子边取**父节点**的 `rootColor`
 * (父子同根轴,值与节点色一致,但口径上必须取父端);有焦点时,在焦点所在轴上的父子边写
 * `alpha = 1`(同轴边提到 100%),其余轴色边写弱化档 0.25 —— 画布只按 `alpha` 覆盖来画。
 */
import type { GraphEdge } from '../../shared/types';
import { screenOf, type Camera } from './graph-camera';
import { isDimmed, type Emphasis } from './graph-focus';
import { AXIS_HOT_ALPHA, AXIS_DIM_ALPHA } from './graph-edge-style';
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
  /** 节点 id -> 轴色令牌值(父子边取父端这一份) */
  rootColor: ReadonlyMap<number, string>;
  /** 节点 id -> 根轴名(判「是否与焦点同轴」) */
  axisOf: ReadonlyMap<number, string>;
  /** 焦点所在根轴;null = 没有焦点,不给 alpha 覆盖 */
  focusAxis: string | null;
}): { co: Segment[]; tree: Segment[] } {
  const { edges, points, cam, visible, emphasis, rootColor, axisOf, focusAxis } = input;
  const co: Segment[] = [];
  const tree: Segment[] = [];
  for (const e of edges) {
    const pa = points.get(e.a);
    const pb = points.get(e.b);
    if (!pa || !pb) continue; // 位置未知的边不画(布局未覆盖该点)
    if (!visible.has(e.a) && !visible.has(e.b)) continue;
    const a = screenOf(pa, cam);
    const b = screenOf(pb, cam);
    const emphasized = e.a === emphasis.active || e.b === emphasis.active;
    const dim = isDimmed(e.a, emphasis) || isDimmed(e.b, emphasis);
    if (e.kind === 'tree') {
      const sameAxis = focusAxis !== null && axisOf.get(e.a) === focusAxis;
      const alpha =
        focusAxis === null ? undefined : sameAxis ? AXIS_HOT_ALPHA : AXIS_DIM_ALPHA;
      tree.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, weight: e.weight, emphasized, dim, color: rootColor.get(e.a), alpha });
    } else {
      co.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, weight: e.weight, emphasized, dim });
    }
  }
  return { co, tree };
}

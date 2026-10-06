/**
 * `drawPlan` 的点层(自 `graph-draw-plan.ts` 抽出):节点圆点、聚合圆、LOD 文字与枢纽外环。
 * 低缩放走聚合(同格合并成带计数的圆),否则逐节点出点。
 */
import type { GraphEdge, GraphNode } from '../../shared/types';
import { tagLabelPlain } from '../../shared/tag-label';
import { aggregateBuckets, shouldAggregate } from './graph-aggregate';
import { lodLevel, screenOf, type Camera } from './graph-camera';
import { isDimmed, type Emphasis } from './graph-focus';
import type { Point } from './radial';
import { aggregateRadius, HUB_NOTES, HUB_RING_DEGREE, radiusOf } from './graph-draw-plan-metrics';
import type { Dot, Label } from './graph-draw-plan-types';

/** 末级段名:标签树里画的是节点名,不是整条路径 */
function leafOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * 点/文字:只画视口内的节点;文字按 LOD 三档取舍(聚合档不出文字,看骨架)。
 * 颜色不在这里硬编码 —— `rootColor` 由调用方按节点给(根色继承),缺项退回 `fallbackColor`。
 */
export function planPoints(input: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  points: Map<number, Point>;
  cam: Camera;
  visible: ReadonlySet<number>;
  emphasis: Emphasis;
  rootColor: Map<number, string>;
  fallbackColor: string;
}): { dots: Dot[]; labels: Label[]; hubs: Dot[] } {
  const { nodes, edges, points, cam, visible, emphasis, rootColor, fallbackColor } = input;
  const dots: Dot[] = [];
  const hubs: Dot[] = [];
  // degree = tree + co edges per node (both express how many relations it has)
  const degree = new Map<number, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const labels: Label[] = [];
  const level = lodLevel(cam.k);
  // 低缩放聚合(设计 D1/D2):同格节点合并成一个带计数的圆,避免多个点挤占同一块像素。
  // 聚合生效时不再逐节点画点、也不画文字(聚合档看骨架,文字没有意义)。
  const aggregated = shouldAggregate(cam.k);
  if (aggregated) {
    const parents = new Map<number, number>();
    const depthOf = new Map<number, number>();
    for (const n of nodes) {
      if (n.parent !== null) parents.set(n.id, n.parent);
      depthOf.set(n.id, n.depth);
    }
    const visibleNodes = nodes.filter((n) => visible.has(n.id) && points.has(n.id));
    const buckets = aggregateBuckets({
      nodes: visibleNodes,
      points,
      parents,
      depthOf: (id) => depthOf.get(id) ?? 0,
      cam,
    });
    for (const b of buckets) {
      dots.push({
        id: b.first,
        x: b.x,
        y: b.y,
        r: aggregateRadius(b.count),
        color: rootColor.get(b.first) ?? fallbackColor,
        dim: isDimmed(b.first, emphasis),
        selected: b.first === emphasis.selected,
        count: b.count,
      });
    }
  }
  // 聚合生效时逐节点循环空转:点由上面的桶给出,而笔记小圆/链接/溢出提示照旧计算
  for (const n of aggregated ? [] : nodes) {
    const p = points.get(n.id);
    if (!p || !visible.has(n.id)) continue;
    const s = screenOf(p, cam);
    const r = radiusOf(n.notes);
    const dot: Dot = {
      id: n.id,
      x: s.x,
      y: s.y,
      r,
      color: rootColor.get(n.id) ?? fallbackColor,
      dim: isDimmed(n.id, emphasis),
      selected: n.id === emphasis.selected,
    };
    dots.push(dot);
    // 枢纽外环(设计 D6):度数够高的节点进 hubs,画布在画完所有点后统一描环。
    // 只在非聚合档判:聚合桶是合并圆,没有单一枢纽语义。
    if ((degree.get(n.id) ?? 0) >= HUB_RING_DEGREE) hubs.push(dot);
    if (level === 'all' || (level === 'hubs' && n.selfCount >= HUB_NOTES)) {
      labels.push({ id: n.id, x: s.x, y: s.y - r - 4, text: tagLabelPlain(leafOf(n.path)) });
    }
  }
  return { dots, labels, hubs };
}

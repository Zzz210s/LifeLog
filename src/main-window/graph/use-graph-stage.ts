/**
 * 关系图的「落点层」接线(G3 Task 4 自 `GraphView` 抽出,守它的 200 行红线):
 *
 *   整理结果(useArrangedLayout)→ 相机(叠加 `graph_positions`)→ 拖节点 → 力导向(useForceLayout)
 *
 * 顺序不能换:相机吃的是**整理后的布局**,所以整理、拖拽、命中检测、绘制看到的是同一份坐标 ——
 * 若把整理结果只贴在绘制层,点节点会点到旧位置上去。
 * 力导向的顺序同样固定:起点要取相机那份**当前**落点(没在拖节点时 `cam.points` 就是画布上那份),
 * 而它的结果又回灌成相机的布局输入,所以必须由 `useArrangedLayout` 隔一道(见 use-force-layout)。
 * 「整理布局」不写库、布局换代即作废的口径都在 use-force-layout 里,这里只摆顺序。
 */
import type { GraphEdge, GraphNode } from '../../shared/types';
import type { Point } from './radial';
import { useArrangedLayout, useForceLayout, type ForceLayoutApi } from './use-force-layout';
import { useGraphCamera, type GraphCameraApi } from './use-graph-camera';
import { useNodeDrag, type NodeDragApi } from './use-node-drag';

export function useGraphStage(input: {
  /** 径向布局结果(力导向没跑过 / 作废后的落点) */
  layout: Map<number, Point>;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** 容器左上角的视口位置(指针换算是它,见 use-graph-origin) */
  origin: () => Point;
  /** 写回位置记忆时的"现存标签"修剪口径 */
  validIds: Set<number>;
  size: { w: number; h: number };
}): { cam: GraphCameraApi; drag: NodeDragApi; force: ForceLayoutApi; points: Map<number, Point> } {
  const arranged = useArrangedLayout(input.layout);
  const cam = useGraphCamera({
    width: input.size.w,
    height: input.size.h,
    points: arranged.points,
    origin: input.origin,
    validIds: input.validIds,
  });
  const drag = useNodeDrag({ nodes: input.nodes, cam, origin: input.origin });
  const force = useForceLayout({
    points: cam.points,
    edges: input.edges,
    anchors: cam.pinned,
    onFrame: arranged.setPoints,
  });
  return { cam, drag, force, points: drag.points };
}

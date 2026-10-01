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
 *
 * 「重置视图」的出口也在这里(`resetView`):要同时作废整理结果(回径向)与复位相机 ——
 * 两个状态分属上下两层,合成动作只该有一份(工具栏按钮与 `0` 键共用它,见下面的 `resetNow`)。
 */
import { useCallback, useRef, useState } from 'react';
import type { GraphEdge, GraphNode } from '../../shared/types';
import type { Point } from './radial';
import { useArrangedLayout, useForceLayout, type ForceLayoutApi } from './use-force-layout';
import { useGraphCamera, type GraphCameraApi } from './use-graph-camera';
import { useNodeDrag, type NodeDragApi } from './use-node-drag';

export interface GraphStage {
  cam: GraphCameraApi;
  drag: NodeDragApi;
  force: ForceLayoutApi;
  /** 画布落点(拖节点时的实时位置也在内) */
  points: Map<number, Point>;
  /** 「重置视图」/ `0`:整理结果作废(回径向)+ 相机重新适配 */
  resetView: () => void;
}

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
}): GraphStage {
  const arranged = useArrangedLayout(input.layout);
  // 复位信号:适配由相机在**下一次渲染**做 —— 那一帧的落点已经是径向布局了。
  // 在这里现算适配会读到整理前的落点(arranged.clear 的状态更新同批次还没生效)。
  const [resetSignal, setResetSignal] = useState(0);
  // `0` 键要走的合成动作在下面才诞生(它要用力导向的 stop),用一次性 ref 转交:
  // 注册入口只需一个稳定函数,调用时取到的永远是最新那次渲染的 resetView。
  const resetNow = useRef<() => void>(() => {});
  const cam = useGraphCamera({
    width: input.size.w,
    height: input.size.h,
    points: arranged.points,
    origin: input.origin,
    validIds: input.validIds,
    resetSignal,
    onReset: () => resetNow.current(),
  });
  const drag = useNodeDrag({ nodes: input.nodes, cam, origin: input.origin });
  const force = useForceLayout({
    points: cam.points,
    edges: input.edges,
    anchors: cam.pinned,
    onFrame: arranged.setPoints,
  });
  const { clear: clearArranged } = arranged;
  const resetView = useCallback((): void => {
    force.stop(); // 还在整理就先停手,否则下一帧又把整理坐标灌回来
    clearArranged();
    setResetSignal((n) => n + 1);
  }, [force, clearArranged]);
  resetNow.current = resetView;
  return { cam, drag, force, points: drag.points, resetView };
}

/**
 * 一帧画什么(plan):把「可见节点与边、落点、相机、视口尺寸、主题、强调态、展开层」合成
 * `drawPlan` 的一次读数。纯函数 `drawPlan` 只算几何,「哪些状态算这一帧」这层口径放在这里,
 * `GraphView` 就只剩接线(自 GraphView 抽出,与 use-graph-data / use-graph-size 同一处理)。
 *
 * **依赖少一样就会静默停在旧画面** —— 画布按 `plan` 引用判等,同引用不重绘,故逐条记下理由:
 * - `themeKey`:兜底色是计划期读的令牌,换主题必须重建 plan(边/文字的颜色在画布里现读)
 * - `dprKey`:纯 DPR 变化时尺寸可能一点没变,不重建 plan 就不会重设后备缓冲(画布停在旧 DPR)
 * - `emphasis`:悬停/选中换了强调态却不重建 plan,点与边就永远亮不起来(G2 Task 5 审查点名)
 * - `expanded`:展开/收起与取数回包都要重画(小圆与 `+N` 在 plan 上;喂进来的是世界坐标,换算归 drawPlan)
 */
import { useMemo } from 'react';
import type { GraphEdge, GraphNode } from '../../shared/types';
import type { Camera } from './graph-camera';
import { drawPlan, type DrawPlan } from './graph-draw-plan';
import { emphasisOf } from './graph-focus';
import type { Point } from './radial';
import { token } from './token';

/** 尺寸没测出来之前的一帧:空计划(与"画完了但没有东西"是两回事,但渲染结果一样) */
const EMPTY_PLAN: DrawPlan = { co: [], tree: [], dots: [], labels: [], notes: [], overflow: null };

export function useGraphPlan(input: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** 落点(世界坐标:相机叠加位置记忆之后的那一份) */
  points: Map<number, Point>;
  cam: Camera;
  size: { w: number; h: number };
  themeKey: string;
  /** 当前 devicePixelRatio(`useDprKey` 的读数;纯 DPR 变化时尺寸可能量不出差别) */
  dprKey: number;
  /** 选中与悬停:强调态由这两个派生(悬停优先于选中,见 graph-focus) */
  selected: number | null;
  hovered: number | null;
  /** 展开的标签与其笔记小圆 / `+N`(世界坐标;来自 useExpandedNotes) */
  expanded: { id: number; dots: Point[]; overflow: { x: number; y: number; n: number } | null } | null;
}): DrawPlan {
  const { nodes, edges, points, cam, size, themeKey, dprKey, selected, hovered, expanded } = input;
  const { w, h } = size;
  // 强调态:悬停优先于选中(焦点跟着光标),选中环与信息条仍归 selected(见 graph-focus)
  const emphasis = useMemo(() => emphasisOf({ selected, hovered, edges }), [selected, hovered, edges]);
  return useMemo(
    () =>
      w === 0 || h === 0
        ? EMPTY_PLAN
        : drawPlan({
            nodes,
            edges,
            points,
            cam,
            w,
            h,
            rootColor: new Map<number, string>(), // G1 不按根着色:统一用主题令牌兜底色
            fallbackColor: token('--color-muted'),
            emphasis,
            expanded,
          }),
    [nodes, edges, points, cam, w, h, themeKey, dprKey, emphasis, expanded],
  );
}

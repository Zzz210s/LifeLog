/**
 * 决定这一帧画什么(纯函数,不碰 DOM、不读主题)。本文件只按层合成 —— 边在 `graph-draw-plan-edges`、
 * 点与文字在 `graph-draw-plan-points`、展开层在 `graph-draw-plan-expanded`、尺寸口径在
 * `graph-draw-plan-metrics`(2026-10-05 拆出,守 200 行红线);类型与口径仍从本文件转出。
 *
 * - 边:至少一端在视口内才画(两端都在视口外的一律丢弃,见设计 §3.2)
 * - 点/文字:只画视口内的节点;文字按 LOD 三档取舍
 * - 颜色:**不在这里硬编码** —— `rootColor` 由调用方按节点给(根色继承),
 *   缺项退回 `fallbackColor`(调用方从主题令牌读出来的值)
 * - 强调:点是/边是否暗由 `emphasis` 决定(渲染时用透明度,不换颜色);
 *   与焦点相连的边另打 `Segment.emphasized`(渲染时加粗);
 *   笔记小圆是被主动展开的,不参与弱化
 */
import type { GraphEdge, GraphLink, GraphNode } from '../../shared/types';
import { cullVisible, type Camera } from './graph-camera';
import { planEdges } from './graph-draw-plan-edges';
import { planExpanded } from './graph-draw-plan-expanded';
import { planPoints } from './graph-draw-plan-points';
import { planRelations } from './graph-draw-plan-relations';
import { nodeFacts } from './graph-plan-cache';
import { radiusOf as radiusFromNotes } from './graph-draw-plan-metrics';
import type { RelationEdge } from './graph-relations';
import type { DrawPlan, ExpandedInput } from './graph-draw-plan-types';
import type { Emphasis } from './graph-focus';
import type { Point } from './radial';

export type {
  Dot,
  DrawPlan,
  ExpandedInput,
  Label,
  NoteDot,
  OverflowDot,
  Segment,
} from './graph-draw-plan-types';
export {
  HUB_RING_DEGREE,
  aggregateRadius,
  radiusOf,
} from './graph-draw-plan-metrics';

export function drawPlan(input: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  points: Map<number, Point>;
  cam: Camera;
  w: number;
  h: number;
  rootColor: Map<number, string>;
  fallbackColor: string;
  emphasis: Emphasis;
  /**
   * 当前展开的标签:其笔记小圆与 `+N` 提示位按 `space` 给 ——
   * `'screen'` 时**已经是屏幕坐标,这里不再换算**(G3 起笔记小圆一律走屏幕口径:
   * 半径是屏幕像素,不随相机缩放);`'world'` 时才由这里过 `screenOf`。
   * 展开者自己不在可见集合里时整组不画(否则会留下飘在空处的孤儿小圆)
   */
  expanded?: ExpandedInput | null;
  /** 全部已解析的笔记间链接(`graph_data` 里 `kind: 'link'` 的那批;两端都是**笔记实体 id**) */
  links?: readonly GraphLink[];
  /** 标签关系边(前端从 `list_tag_facts` 摊平;两端都是**标签实体 id**,带箭头) */
  relations?: readonly RelationEdge[];
}): DrawPlan {
  const { nodes, edges, points, cam, w, h, rootColor, fallbackColor, emphasis } = input;
  const visible = new Set(cullVisible(points, cam, w, h));
  const { dots, labels, hubs } = planPoints({
    nodes,
    edges,
    points,
    cam,
    visible,
    emphasis,
    rootColor,
    fallbackColor,
  });
  // 箭头回收要按**目标半径**:点层先算,把每个圆点的半径(聚合档是桶半径)喂给关系层
  const radiusById = new Map(dots.map((d) => [d.id, d.r] as const));
  // 父子边取父节点轴色、并按「焦点所在轴」定同轴强调(2026-10-06 边视觉重做):
  // 根轴名从节点路径推(逐帧不变的派生件按 nodes 引用缓存,见 graph-plan-cache),
  // 轴色由调用方的 rootColor 给(令牌值),两处都不在这里碰色值。
  const facts = nodeFacts(nodes);
  const axisOf = facts.axisOf;
  const focusAxis = emphasis.active === null ? null : axisOf.get(emphasis.active) ?? null;
  const { co, tree } = planEdges({ edges, points, cam, visible, emphasis, rootColor, axisOf, focusAxis });
  const { segments: relations, marks: relationMarks } = planRelations({
    relations: input.relations ?? [],
    points,
    cam,
    visible,
    emphasis,
    radiusOf: (id) => radiusById.get(id) ?? radiusFromNotes(facts.notesById.get(id) ?? 0),
  });
  const { notes, links, overflow } = planExpanded({
    expanded: input.expanded ?? null,
    links: input.links ?? [],
    cam,
    visible,
  });
  return { co, tree, relations, links, dots, hubs, labels, relationMarks, notes, overflow };
}

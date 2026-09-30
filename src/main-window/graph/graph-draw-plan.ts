import type { GraphEdge, GraphNode } from '../../shared/types';
import { cullVisible, lodLevel, screenOf, type Camera } from './graph-camera';
import { isDimmed, type Emphasis } from './graph-focus';
import type { Point } from './radial';

/** 一条待描的线段(坐标已是屏幕 CSS 像素) */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
  /**
   * 画粗的一类边:**任一端是当前焦点 `emphasis.active`**(设计 §5「邻居边加粗」)。
   * 与 `dim` 并存:焦点的另一头若是无关节点,这条边仍会 `dim === true`,但画布按
   * `emphasized` 优先 —— 强调边永远满不透明(见 `GraphCanvas.tsx`)。
   */
  emphasized: boolean;
  /** 弱化(有焦点时,与焦点/邻居都无关的边走暗);画布用 globalAlpha 表达,不改颜色 */
  dim: boolean;
}

/** 一个节点圆点:半径随笔记数增长(有上限),颜色由调用方给 */
export interface Dot {
  id: number;
  x: number;
  y: number;
  r: number;
  color: string;
  dim: boolean;
  /** 是否画选中环:跟 `emphasis.selected` 走,不跟焦点走 */
  selected: boolean;
}

/** 一个节点文字:坐标为文字基线中心(点上方),text 是末级段名 */
export interface Label {
  id: number;
  x: number;
  y: number;
  text: string;
}

/** 一条展开笔记的小圆(屏幕坐标);等到能点到单条笔记时再带上笔记身份 */
export type NoteDot = Point;

/** 被略去的笔记条数提示位(屏幕坐标) */
export interface OverflowDot {
  x: number;
  y: number;
  n: number;
}

/** 一帧要画的东西:边按类型分层,点与文字各自成列,另带展开的笔记小圆 */
export interface DrawPlan {
  co: Segment[];
  tree: Segment[];
  dots: Dot[];
  labels: Label[];
  /** 当前展开标签下的笔记小圆;不展开时为空数组 */
  notes: NoteDot[];
  /** 略去的条数提示位;没略去时为 null */
  overflow: OverflowDot | null;
}

/** LOD 中档(hubs)显示文字的笔记数阈值(设计 §3.2) */
const HUB_NOTES = 100;
const MIN_R = 2.5;
const MAX_R = 9;

/**
 * 点半径:随笔记数开方增长,撞上限即封顶(1177 条笔记也已到顶)。
 * 导出给命中检测(`graph-hit.ts`)复用 —— 一处定义,两处使用。
 */
export function radiusOf(notes: number): number {
  return Math.min(MAX_R, MIN_R + Math.sqrt(Math.max(notes, 0)) / 4);
}

/** 末级段名:标签树里画的是节点名,不是整条路径 */
function leafOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * 决定这一帧画什么(纯函数,不碰 DOM、不读主题)。
 * - 边:至少一端在视口内才画(两端都在视口外的一律丢弃,见设计 §3.2)
 * - 点/文字:只画视口内的节点;文字按 LOD 三档取舍
 * - 颜色:**不在这里硬编码** —— `rootColor` 由调用方按节点给(根色继承),
 *   缺项退回 `fallbackColor`(调用方从主题令牌读出来的值)
 * - 强调:点是/边是否暗由 `emphasis` 决定(渲染时用透明度,不换颜色);
 *   与焦点相连的边另打 `Segment.emphasized`(渲染时加粗);
 *   笔记小圆是被主动展开的,不参与弱化
 */
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
   * 当前展开的标签:其笔记小圆与 `+N` 提示位是**世界坐标**;
   * 展开者自己不在可见集合里时整组不画(否则会留下飘在空处的孤儿小圆)
   */
  expanded?: { id: number; dots: readonly Point[]; overflow: { x: number; y: number; n: number } | null } | null;
}): DrawPlan {
  const { nodes, edges, points, cam, w, h, rootColor, fallbackColor, emphasis } = input;
  const visible = new Set(cullVisible(points, cam, w, h));
  const co: Segment[] = [];
  const tree: Segment[] = [];
  for (const e of edges) {
    const pa = points.get(e.a);
    const pb = points.get(e.b);
    if (!pa || !pb) continue; // 位置未知的边不画(布局未覆盖该点)
    if (!visible.has(e.a) && !visible.has(e.b)) continue;
    const a = screenOf(pa, cam);
    const b = screenOf(pb, cam);
    // 只要有一端暗,这条边就暗(边是自己画不亮的,一端进了暗处就跟着暗)
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
  const dots: Dot[] = [];
  const labels: Label[] = [];
  const level = lodLevel(cam.k);
  for (const n of nodes) {
    const p = points.get(n.id);
    if (!p || !visible.has(n.id)) continue;
    const s = screenOf(p, cam);
    const r = radiusOf(n.notes);
    dots.push({
      id: n.id,
      x: s.x,
      y: s.y,
      r,
      color: rootColor.get(n.id) ?? fallbackColor,
      dim: isDimmed(n.id, emphasis),
      selected: n.id === emphasis.selected,
    });
    if (level === 'all' || (level === 'hubs' && n.notes >= HUB_NOTES)) {
      labels.push({ id: n.id, x: s.x, y: s.y - r - 4, text: leafOf(n.path) });
    }
  }
  const notes: NoteDot[] = [];
  let overflow: OverflowDot | null = null;
  const ex = input.expanded ?? null;
  if (ex !== null && visible.has(ex.id)) {
    for (const d of ex.dots) notes.push(screenOf(d, cam));
    if (ex.overflow !== null) {
      const s = screenOf(ex.overflow, cam);
      overflow = { x: s.x, y: s.y, n: ex.overflow.n };
    }
  }
  return { co, tree, dots, labels, notes, overflow };
}

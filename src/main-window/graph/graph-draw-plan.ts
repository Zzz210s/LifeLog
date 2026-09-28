import type { GraphEdge, GraphNode } from '../../shared/types';
import { cullVisible, lodLevel, screenOf, type Camera } from './graph-camera';
import type { Point } from './radial';

/** 一条待描的线段(坐标已是屏幕 CSS 像素) */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
}

/** 一个节点圆点:半径随笔记数增长(有上限),颜色由调用方给 */
export interface Dot {
  id: number;
  x: number;
  y: number;
  r: number;
  color: string;
}

/** 一个节点文字:坐标为文字基线中心(点上方),text 是末级段名 */
export interface Label {
  id: number;
  x: number;
  y: number;
  text: string;
}

/** 一帧要画的东西:边按类型分层,点与文字各自成列 */
export interface DrawPlan {
  co: Segment[];
  tree: Segment[];
  dots: Dot[];
  labels: Label[];
}

/** LOD 中档(hubs)显示文字的笔记数阈值(设计 §3.2) */
const HUB_NOTES = 100;
const MIN_R = 2.5;
const MAX_R = 9;

/** 点半径:随笔记数开方增长,撞上限即封顶(1177 条笔记也已到顶) */
function radiusOf(notes: number): number {
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
}): DrawPlan {
  const { nodes, edges, points, cam, w, h, rootColor, fallbackColor } = input;
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
    const seg: Segment = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, weight: e.weight };
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
    dots.push({ id: n.id, x: s.x, y: s.y, r, color: rootColor.get(n.id) ?? fallbackColor });
    if (level === 'all' || (level === 'hubs' && n.notes >= HUB_NOTES)) {
      labels.push({ id: n.id, x: s.x, y: s.y - r - 4, text: leafOf(n.path) });
    }
  }
  return { co, tree, dots, labels };
}

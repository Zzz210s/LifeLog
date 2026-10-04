import type { GraphEdge, GraphLink, GraphNode } from '../../shared/types';
import { aggregateBuckets, shouldAggregate } from './graph-aggregate';
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
  /** 聚合计数(>1 才画数字,2026-10-04 设计 D1):低缩放时同格合并,记它代表多少个节点 */
  count?: number;
}

/** 一个节点文字:坐标为文字基线中心(点上方),text 是末级段名 */
export interface Label {
  id: number;
  x: number;
  y: number;
  text: string;
}

/** 一条展开笔记的小圆(屏幕坐标)。`id` 是**笔记 id**:L4 的 link 边要靠它认出两端 */
export type NoteDot = { id: number; x: number; y: number };

/**
 * 被略去的笔记条数提示位(屏幕坐标)。
 * `id` 是它所属的标签:它画在标签环外偏下(`noteFan` 的 `OVERFLOW_GAP`),命中它要知道该带哪个标签
 * 回信息流,所以这一位不随坐标换算丢掉身份(见 `use-graph-interactions` 的 `+N` 判据)。
 */
export interface OverflowDot {
  id: number;
  x: number;
  y: number;
  n: number;
}

/** 一帧要画的东西:边按类型分层,点与文字各自成列,另带展开的笔记小圆 */
export interface DrawPlan {
  co: Segment[];
  tree: Segment[];
  /** 笔记间的 link 边(accent 色;两端笔记都在展开的扇形里才有一条) */
  links: Segment[];
  dots: Dot[];
  labels: Label[];
  /** 当前展开标签下的笔记小圆;不展开时为空数组 */
  notes: NoteDot[];
  /** 略去的条数提示位;没略去时为 null */
  overflow: OverflowDot | null;
}

/** LOD 中档(hubs)显示文字的阈值。口径是**本级**计数(2026-10-01 改):`notes` 是含子级,
 *  展开时间轴后 `时间/日期/2026/03/28` 这类末级段名会靠祖先的计数抢到文字;`selfCount` 才是
 *  "这个标签本身装了多少东西",用它文字才落在真正的枢纽上(设计 §3.2 的枢纽判据)。 */
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
   * 当前展开的标签:其笔记小圆与 `+N` 提示位按 `space` 给 ——
   * `'screen'` 时**已经是屏幕坐标,这里不再换算**(G3 起笔记小圆一律走屏幕口径:
   * 半径是屏幕像素,不随相机缩放);`'world'` 时才由这里过 `screenOf`。
   * 展开者自己不在可见集合里时整组不画(否则会留下飘在空处的孤儿小圆)
   */
  expanded?: {
    id: number;
    space: 'screen' | 'world';
    dots: readonly NoteDot[];
    overflow: { id: number; x: number; y: number; n: number } | null;
  } | null;
  /** 全部已解析的笔记间链接(`graph_data` 里 `kind: 'link'` 的那批;两端都是笔记 id) */
  links?: readonly GraphLink[];
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
        r: radiusOf(b.count),
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
    dots.push({
      id: n.id,
      x: s.x,
      y: s.y,
      r,
      color: rootColor.get(n.id) ?? fallbackColor,
      dim: isDimmed(n.id, emphasis),
      selected: n.id === emphasis.selected,
    });
    if (level === 'all' || (level === 'hubs' && n.selfCount >= HUB_NOTES)) {
      labels.push({ id: n.id, x: s.x, y: s.y - r - 4, text: leafOf(n.path) });
    }
  }
  const notes: NoteDot[] = [];
  const links: Segment[] = [];
  let overflow: OverflowDot | null = null;
  const ex = input.expanded ?? null;
  if (ex !== null && visible.has(ex.id)) {
    // 屏幕口径原样用,世界口径才过相机 —— 判据只在 expanded.space 一处
    const toScreen = (p: Point): Point => (ex.space === 'screen' ? p : screenOf(p, cam));
    for (const d of ex.dots) notes.push({ id: d.id, ...toScreen(d) });
    // link 边:两端笔记都在这一圈小圆里才画(看不见的一端没有落点,画出来是飘在空处的线)。
    // `emphasized` / `dim` 恒 false:强调态的 active/selected 是**标签** id,让笔记 id 去撞它
    // 会毫无预兆地画出一条粗线或暗线(两套 id 真的会同数)。
    const at = new Map(notes.map((n) => [n.id, n]));
    for (const l of input.links ?? []) {
      const s = at.get(l.a);
      const t = at.get(l.b);
      if (s === undefined || t === undefined || l.a === l.b) continue;
      links.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y, weight: 1, emphasized: false, dim: false });
    }
    if (ex.overflow !== null) {
      const s = toScreen(ex.overflow);
      overflow = { id: ex.overflow.id, x: s.x, y: s.y, n: ex.overflow.n };
    }
  }
  return { co, tree, links, dots, labels, notes, overflow };
}

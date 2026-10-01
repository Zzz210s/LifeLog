/**
 * 「整理布局」的力导向(纯函数,零 DOM,可单测)。
 *
 * 一步 = 三股力叠加,再乘 `alpha` 阻尼成位移:
 * - 斥力:节点两两相斥(力 = REPULSION / d²);**网格分桶**只算同桶与邻桶的对,
 *   复杂度 O(n·k),避开 768² ≈ 59 万对的全算(设计 §3.4 点名要避开的那个量级)
 * - 弹簧:每条边把两端拉向 IDEAL_LEN(力 = SPRING × weight × (d − IDEAL_LEN))
 * - 向心:每个节点受一个指向原点的弱力,整图不会越摊越远
 *
 * 阻尼:`alpha` 是这一步的全局阻尼(位移 = 力 × alpha)。**逐步衰减(× ALPHA_DECAY)由调度方做**
 * (`use-force-layout`)—— 纯函数不持有跨步状态,同输入必然同输出,才好单测。
 * 单步位移上限 MAX_STEP:近邻斥力在 d → 0 时会爆,夹住它才不会把点炸飞。
 *
 * `anchors`(被拖过的节点)当墙:受力照算(邻点该被推开还是被推开),但它们的坐标原样返回。
 */
import type { GraphEdge } from '../../shared/types';
import type { Point } from './radial';

/** 斥力强度:力 = REPULSION / d²(d 是世界坐标距离) */
export const REPULSION = 5000;
/** 弹簧劲度:力 = SPRING × weight × (d − IDEAL_LEN) */
export const SPRING = 0.05;
/** 边的理想长度(世界坐标):与径向布局的层距(LAYER_GAP = 90)同档 */
export const IDEAL_LEN = 80;
/** 向心弱力系数:力 = CENTER_PULL × 到原点的距离(避免整图飘走) */
export const CENTER_PULL = 0.015;
/** 单步位移上限(世界坐标):近距离斥力不能让点瞬移 */
export const MAX_STEP = 24;
/** 每步的阻尼衰减(调度方乘;越小停得越快、摊得越紧) */
export const ALPHA_DECAY = 0.98;
/** 网格边长(世界坐标):桶太大退化成 O(n²),太小则邻桶查不满 */
export const DEFAULT_GRID = 90;
/** 距离平方下限:同一位置或几乎重合时不除零 */
const MIN_D2 = 1;
/**
 * 相邻桶的 4 个"半圈"方向(右上 / 右 / 右下 / 下)。只取半圈是为了每个无序桶对只算一次:
 * 桶对 (A, B) 与 (B, A) 互为反向,取半圈后恰好覆盖全部 8 邻域而不会重复。
 */
const HALF_NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
];

interface Body {
  id: number;
  x: number;
  y: number;
}

/** 按网格分桶:键是 `col,row`(世界坐标 floor 到格) */
function bucketize(points: Map<number, Point>, grid: number): Map<string, Body[]> {
  const cells = new Map<string, Body[]>();
  for (const [id, p] of points) {
    const key = `${Math.floor(p.x / grid)},${Math.floor(p.y / grid)}`;
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [{ id, x: p.x, y: p.y }]);
    else list.push({ id, x: p.x, y: p.y });
  }
  return cells;
}

export interface ForceStepInput {
  /** 这一步的坐标(世界坐标);不会被改写 */
  points: Map<number, Point>;
  edges: readonly GraphEdge[];
  /** 不动的节点(被拖过、位置记忆里有):坐标原样返回 */
  anchors: ReadonlySet<number>;
  /** 这一步的阻尼(0, 1];逐步衰减由调用方做 */
  alpha: number;
  /** 网格边长(世界坐标) */
  grid: number;
}

/**
 * 走一步力导向,返回**新的**坐标表(输入不改)。`anchors` 里的节点坐标原样返回;
 * 其余节点位移 = clamp(力向量) × alpha,方向与力一致、模长不超过 MAX_STEP。
 */
export function forceStep(input: ForceStepInput): Map<number, Point> {
  const { points, edges, anchors, alpha, grid } = input;
  const fx = new Map<number, number>();
  const fy = new Map<number, number>();
  const push = (id: number, x: number, y: number): void => {
    fx.set(id, (fx.get(id) ?? 0) + x);
    fy.set(id, (fy.get(id) ?? 0) + y);
  };

  const cells = bucketize(points, grid);
  const repel = (a: Body, b: Body): void => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const d2 = Math.max(dx * dx + dy * dy, MIN_D2);
    const d = Math.sqrt(d2);
    const f = REPULSION / d2;
    const ux = (dx / d) * f;
    const uy = (dy / d) * f;
    push(a.id, ux, uy);
    push(b.id, -ux, -uy);
  };
  for (const [key, bodies] of cells) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) repel(bodies[i], bodies[j]);
    }
    const [cx, cy] = key.split(',').map(Number) as [number, number];
    for (const [ox, oy] of HALF_NEIGHBORS) {
      const other = cells.get(`${cx + ox},${cy + oy}`);
      if (other === undefined) continue;
      for (const a of bodies) for (const b of other) repel(a, b);
    }
  }

  for (const e of edges) {
    const pa = points.get(e.a);
    const pb = points.get(e.b);
    if (pa === undefined || pb === undefined) continue; // 悬空边:一端被过滤器藏起来
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const d = Math.sqrt(Math.max(dx * dx + dy * dy, MIN_D2));
    const f = SPRING * (e.weight || 1) * (d - IDEAL_LEN); // d > IDEAL 时为正 = 互相吸引
    const ux = (dx / d) * f;
    const uy = (dy / d) * f;
    push(e.a, ux, uy);
    push(e.b, -ux, -uy);
  }

  const out = new Map<number, Point>();
  for (const [id, p] of points) {
    if (anchors.has(id)) {
      out.set(id, p); // 墙:受力照算(邻点被推开),但自己不动
      continue;
    }
    const vx = (fx.get(id) ?? 0) - p.x * CENTER_PULL;
    const vy = (fy.get(id) ?? 0) - p.y * CENTER_PULL;
    // 位移 = 力 × alpha,模长夹在 MAX_STEP(近邻斥力会爆);这一步的"力 → 位移"倍率就是它
    const mag = Math.hypot(vx, vy);
    const scale = mag === 0 ? alpha : Math.min(alpha, MAX_STEP / mag);
    const dx = vx * scale;
    const dy = vy * scale;
    out.set(id, dx === 0 && dy === 0 ? p : { x: p.x + dx, y: p.y + dy });
  }
  return out;
}

/** 收敛判据:两张坐标表逐点最大位移 < eps(缺点的表按"动了"处理,不当成收敛) */
export function isConverged(prev: Map<number, Point>, next: Map<number, Point>, eps: number): boolean {
  for (const [id, p] of prev) {
    const q = next.get(id);
    if (q === undefined) return false;
    if (Math.hypot(q.x - p.x, q.y - p.y) >= eps) return false;
  }
  return true;
}

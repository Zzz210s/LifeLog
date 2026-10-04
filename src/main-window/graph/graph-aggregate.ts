/**
 * 低缩放聚合(2026-10-04 设计 D1/D2,依据 ui-ux-pro-max「节点 > 500 必须先聚类/LOD」)。
 *
 * 两个层次,按顺序:
 *   ① **深度聚合**:缩放低于阈值时只保留到深度 N,更深的节点并入最近的已保留祖先
 *      (标签树语义:低缩放看骨架);
 *   ② **网格聚合**:剩下的节点按**屏幕**网格(默认 24px 一格)分桶,同格 ≥2 个合并成一个
 *      聚合圆,带计数;同格只有 1 个则原样保留。
 * 聚合圆保留计数之和 = 原节点数(验收要核这个等式)。
 *
 * 纯函数:输入 = 节点(含世界坐标与深度)+ 相机缩放,输出 = 绘制用的聚合结果。
 */
import type { GraphNode } from '../../shared/types';
import { screenOf, type Camera } from './graph-camera';
import type { Point } from './radial';

/** 屏幕网格边长(px):同格合并 */
export const GRID_PX = 24;
/** 低于这个缩放才做聚合 */
export const AGGREGATE_BELOW_K = 0.6;
/** 聚合时的最大保留深度:超过它的节点并入祖先 */
export const AGGREGATE_MAX_DEPTH = 3;

export interface AggregateInput {
  nodes: readonly GraphNode[];
  points: ReadonlyMap<number, Point>;
  /** 父节点 id(用于深度聚合);没有父的节点不并 */
  parents: ReadonlyMap<number, number>;
  depthOf: (id: number) => number;
  cam: Camera;
  /** 展开的笔记小圆不受聚合影响(它们本来就在高缩放才出现) */
}

export interface AggregateBucket {
  /** 聚合桶的屏幕坐标(桶内节点屏幕坐标的均值) */
  x: number;
  y: number;
  /** 桶内节点数;1 表示未聚合的单点 */
  count: number;
  /** 桶内第一个节点 id(单点时就是它自己) */
  first: number;
}

/** 聚合是否生效(缩放够小才做) */
export function shouldAggregate(k: number): boolean {
  return k < AGGREGATE_BELOW_K;
}

/**
 * 把一个节点归到"深度聚合后的代表"上:自身深度超限就沿父链上溯,
 * 直到深度 ≤ 上限或没有父(无父则仍用自己,避免丢点)。
 */
export function depthRepresentative(
  id: number,
  parents: ReadonlyMap<number, number>,
  depthOf: (id: number) => number,
  maxDepth: number = AGGREGATE_MAX_DEPTH,
): number {
  let cur = id;
  let guard = 0;
  while (depthOf(cur) > maxDepth && guard < 64) {
    const parent = parents.get(cur);
    if (parent === undefined) break;
    cur = parent;
    guard += 1;
  }
  return cur;
}

/** 按屏幕网格分桶;返回每个桶的坐标(均值)与计数 */
export function aggregateBuckets(input: AggregateInput): AggregateBucket[] {
  const { nodes, points, parents, depthOf, cam } = input;
  // 缩放够大:不聚合,一个节点一个桶(网格只在聚合时用)
  if (!shouldAggregate(cam.k)) {
    const out: AggregateBucket[] = [];
    for (const n of nodes) {
      const p = points.get(n.id);
      if (!p) continue;
      const s = screenOf(p, cam);
      out.push({ x: s.x, y: s.y, count: 1, first: n.id });
    }
    return out;
  }
  const grid = GRID_PX / Math.max(cam.k, 0.0001); // 世界单位下的格边长
  const buckets = new Map<string, { sx: number; sy: number; count: number; first: number }>();
  for (const n of nodes) {
    const p = points.get(n.id);
    if (!p) continue;
    const rep = depthRepresentative(n.id, parents, depthOf);
    const rp = points.get(rep) ?? p;
    const s = screenOf(rp, cam);
    const key = `${Math.floor(rp.x / grid)}:${Math.floor(rp.y / grid)}`;
    const hit = buckets.get(key);
    if (hit) {
      hit.sx += s.x;
      hit.sy += s.y;
      hit.count += 1;
    } else {
      buckets.set(key, { sx: s.x, sy: s.y, count: 1, first: rep });
    }
  }
  return [...buckets.values()].map((b) => ({
    x: b.sx / b.count,
    y: b.sy / b.count,
    count: b.count,
    first: b.first,
  }));
}

/** 校验用:聚合后的计数之和必须等于输入节点数(不丢点) */
export function totalCount(buckets: readonly AggregateBucket[]): number {
  return buckets.reduce((sum, b) => sum + b.count, 0);
}

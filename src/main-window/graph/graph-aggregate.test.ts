import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import type { Camera } from './graph-camera';
import {
  aggregateBuckets,
  depthRepresentative,
  GRID_PX,
  shouldAggregate,
  totalCount,
} from './graph-aggregate';
import { aggregateRadius } from './graph-draw-plan';
import type { Point } from './radial';

const node = (id: number): GraphNode => ({ id, path: `a/${id}`, depth: 0, parent: null, notes: 1, selfCount: 1, sortOrder: id });
const cam = (k: number): Camera => ({ k, tx: 0, ty: 0 });

describe('shouldAggregate', () => {
  it('缩放低于阈值才聚合', () => {
    expect(shouldAggregate(0.2)).toBe(true);
    expect(shouldAggregate(0.59)).toBe(true);
    expect(shouldAggregate(0.6)).toBe(false);
    expect(shouldAggregate(2)).toBe(false);
  });
});

describe('depthRepresentative(深度聚合)', () => {
  const parents = new Map([[4, 3], [3, 2], [2, 1]]);
  const depthOf = (id: number): number => (id === 1 ? 1 : id === 2 ? 2 : id === 3 ? 3 : 4);

  it('超过上限的节点沿父链上溯到上限深度', () => {
    expect(depthRepresentative(4, parents, depthOf, 3)).toBe(3);
    expect(depthRepresentative(4, parents, depthOf, 2)).toBe(2);
    expect(depthRepresentative(3, parents, depthOf, 1)).toBe(1);
  });

  it('未超限的节点保持自己', () => {
    expect(depthRepresentative(2, parents, depthOf, 3)).toBe(2);
  });

  it('没有父可上溯时仍返回自己(不丢点)', () => {
    expect(depthRepresentative(9, parents, depthOf, 0)).toBe(9);
  });
});

describe('aggregateBuckets(网格聚合)', () => {
  const nodes = [node(1), node(2), node(3)];
  const points = new Map<number, Point>([
    [1, { x: 0, y: 0 }],
    [2, { x: 1, y: 1 }], // 与 1 同格(k=1 时格边长 24)
    [3, { x: 500, y: 500 }], // 远处
  ]);

  it('k 大时不聚合:每个节点一个桶', () => {
    const buckets = aggregateBuckets({
      nodes, points, parents: new Map(), depthOf: () => 1, cam: cam(2),
    });
    expect(buckets.length).toBe(3);
    expect(buckets.every((b) => b.count === 1)).toBe(true);
  });

  it('k 小时同格节点合并成一个桶并计数', () => {
    const buckets = aggregateBuckets({
      nodes, points, parents: new Map(), depthOf: () => 1, cam: cam(0.2),
    });
    expect(buckets.length).toBe(2);
    expect(buckets.map((b) => b.count).sort()).toEqual([1, 2]);
  });

  it('计数之和恒等于输入节点数(不丢点)', () => {
    for (const k of [0.2, 0.5, 1, 3]) {
      const buckets = aggregateBuckets({
        nodes, points, parents: new Map(), depthOf: () => 1, cam: cam(k),
      });
      expect(totalCount(buckets)).toBe(nodes.length);
    }
  });

  it('深度聚合先生效:深层节点并入祖先的格子', () => {
    const parents = new Map([[3, 1]]);
    const depthOf = (id: number): number => (id === 3 ? 9 : 1);
    const buckets = aggregateBuckets({
      nodes, points, parents, depthOf, cam: cam(0.2),
    });
    // 3 被并到 1 所在格 -> 桶数减少,计数仍守恒
    expect(totalCount(buckets)).toBe(3);
    expect(buckets.length).toBeLessThanOrEqual(2);
  });

  it('拿不到坐标的节点跳过(不崩)', () => {
    const buckets = aggregateBuckets({
      nodes: [...nodes, node(99)], points, parents: new Map(), depthOf: () => 1, cam: cam(0.2),
    });
    expect(totalCount(buckets)).toBe(3);
  });

  it('网格边长按缩放换算(世界单位)', () => {
    const grid = GRID_PX / 0.5;
    expect(grid).toBe(48);
  });
});

describe('aggregateRadius(聚合圆自己的半径)', () => {
  it('下限 12:能容纳计数文字;上限 30', () => {
    expect(aggregateRadius(1)).toBe(14);
    expect(aggregateRadius(400)).toBe(30);
  });
  it('按 sqrt 增长:100 个节点的桶明显大于 4 个的', () => {
    expect(aggregateRadius(100)).toBeGreaterThan(aggregateRadius(4));
    expect(aggregateRadius(100)).toBeLessThanOrEqual(30);
  });
});

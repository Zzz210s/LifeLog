/**
 * 枢纽**外环**的判别力用例(2026-10-05 回归钉住)。
 *
 * 背景:`planPoints` 里 `hubs` 曾长期是空数组(阈值 2026-10-04 从 `selfCount` 改判据为**度数**时
 * 只加了 `degree` 映射,漏了 `hubs.push`),`GraphCanvas` 的 `if (hubs.length > 0)` 因此永不进入,
 * 外环一次都没被画出来。既有夹具全是 `hubs: []`,1811 个用例全绿也测不出。
 *
 * 判据(设计 D6):degree = 父子边 + 共现边之和,>= HUB_RING_DEGREE(10) 进 hubs。
 */
import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../shared/types';
import { drawPlan } from './graph-draw-plan';
import { HUB_RING_DEGREE } from './graph-draw-plan-metrics';
import { NO_EMPHASIS } from './graph-focus';

/** 构造一个星形:中心 1 连出 `spokes` 条共现边;中心度数 = spokes,叶子度数 = 1 */
function star(spokes: number): { nodes: GraphNode[]; edges: GraphEdge[]; points: Map<number, { x: number; y: number }> } {
  const nodes: GraphNode[] = [
    { id: 1, path: '枢纽', depth: 1, parent: null, notes: 5, selfCount: 5, sortOrder: 0 },
  ];
  const edges: GraphEdge[] = [];
  const points = new Map<number, { x: number; y: number }>([[1, { x: 0, y: 0 }]]);
  for (let i = 1; i <= spokes; i += 1) {
    nodes.push({ id: i + 1, path: `枢纽/叶${i}`, depth: 2, parent: 1, notes: 1, selfCount: 1, sortOrder: 0 });
    edges.push({ a: 1, b: i + 1, kind: 'co', weight: 1 });
    points.set(i + 1, { x: (i % 8) * 20 - 70, y: 60 });
  }
  return { nodes, edges, points };
}

const base = {
  cam: { k: 1, tx: 200, ty: 150 },
  w: 400,
  h: 300,
  rootColor: new Map<number, string>(),
  fallbackColor: '#888888',
  emphasis: NO_EMPHASIS,
};

describe('枢纽外环:度数 >= 10 的节点进 hubs', () => {
  it('度数 10 的中心节点被收进 hubs,坐标与 dots 里的同一点一致', () => {
    const { nodes, edges, points } = star(HUB_RING_DEGREE);
    const plan = drawPlan({ ...base, nodes, edges, points });
    const dot = plan.dots.find((d) => d.id === 1);
    expect(dot).toBeDefined();
    expect(plan.hubs.length).toBeGreaterThan(0);
    const hub = plan.hubs.find((h) => h.id === 1);
    expect(hub).toBeDefined();
    expect(hub!.x).toBe(dot!.x);
    expect(hub!.y).toBe(dot!.y);
    expect(hub!.r).toBe(dot!.r);
  });

  it('反例:度数 9(差 1)的中心不进 hubs;每个叶子只连 1 条边也不进', () => {
    const { nodes, edges, points } = star(HUB_RING_DEGREE - 1);
    const plan = drawPlan({ ...base, nodes, edges, points });
    expect(plan.dots.some((d) => d.id === 1)).toBe(true); // 点照画,只是不带环
    expect(plan.hubs).toEqual([]);
  });

  it('聚合档(缩放 < 0.6)的桶是合并圆,没有单一枢纽语义,hubs 必须为空', () => {
    const { nodes, edges, points } = star(HUB_RING_DEGREE + 4);
    const plan = drawPlan({ ...base, nodes, edges, points, cam: { k: 0.5, tx: 200, ty: 150 } });
    expect(plan.dots.length).toBeGreaterThan(0); // 确认确实走了聚合分支
    expect(plan.hubs).toEqual([]);
  });
});

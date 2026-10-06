/**
 * 计划层的边着色/弱化(2026-10-06 边视觉重做):
 * - 父子边取**父节点**的根轴色(`tree_edges` 的 `a = parent_id`),不是子节点的色;
 * - 有焦点时:同轴边 `alpha = 1`,其余轴色边压到弱化档 0.25;
 * - 无焦点时不给 `alpha`(交给画布用层基础值 70%);
 * 夹具里故意让父子端点拿到**不同**的 rootColor,好钉死「取父不取子」(拿子端实现立刻红)。
 */
import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../shared/types';
import { NO_EMPHASIS, emphasisOf } from './graph-focus';
import { drawPlan } from './graph-draw-plan';

const nodes: GraphNode[] = [
  { id: 1, path: '时间', depth: 1, parent: null, notes: 9, selfCount: 9, sortOrder: 0 },
  { id: 2, path: '时间/日期', depth: 2, parent: 1, notes: 9, selfCount: 9, sortOrder: 0 },
  { id: 3, path: '地点', depth: 1, parent: null, notes: 9, selfCount: 9, sortOrder: 0 },
  { id: 4, path: '地点/所在', depth: 2, parent: 3, notes: 9, selfCount: 9, sortOrder: 0 },
];
const edges: GraphEdge[] = [
  { a: 1, b: 2, kind: 'tree', weight: 1 },
  { a: 3, b: 4, kind: 'tree', weight: 1 },
  { a: 1, b: 3, kind: 'co', weight: 5 },
];
const points = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 100, y: 0 }],
  [3, { x: 0, y: 100 }],
  [4, { x: 100, y: 100 }],
]);
const base = {
  nodes,
  edges,
  points,
  cam: { k: 1, tx: 200, ty: 150 },
  w: 400,
  h: 300,
  // 父子端点故意不同色:证明取的是父端(a)
  rootColor: new Map([
    [1, 'cTime'],
    [2, 'cChild'],
    [3, 'cPlace'],
    [4, 'cPlaceChild'],
  ]),
  fallbackColor: 'c0',
  emphasis: NO_EMPHASIS,
};

describe('drawPlan:边的轴色与同轴强调', () => {
  it('父子边取父节点根轴色(拿子节点实现会红),无焦点时不给 alpha', () => {
    const p = drawPlan(base);
    expect(p.tree.map((s) => s.color)).toEqual(['cTime', 'cPlace']);
    expect(p.tree.map((s) => s.alpha)).toEqual([undefined, undefined]);
    // 共现边没有轴色语义,不挂 color
    expect(p.co.map((s) => s.color)).toEqual([undefined]);
  });

  it('悬停时间轴节点:时间轴父子边 alpha=1,地点轴父子边压到 0.25', () => {
    const p = drawPlan({ ...base, emphasis: emphasisOf({ selected: null, hovered: 2, edges }) });
    expect(p.tree[0].alpha).toBe(1); // 1-2 属时间轴
    expect(p.tree[1].alpha).toBe(0.25); // 3-4 属地点轴
  });

  it('悬停地点轴节点:强调跟着焦点所在轴换边', () => {
    const p = drawPlan({ ...base, emphasis: emphasisOf({ selected: null, hovered: 4, edges }) });
    expect(p.tree[0].alpha).toBe(0.25);
    expect(p.tree[1].alpha).toBe(1);
  });

  it('聚合档(缩放 < 0.6)的边仍按父节点轴色画', () => {
    const p = drawPlan({ ...base, cam: { k: 0.5, tx: 200, ty: 150 } });
    expect(p.tree.map((s) => s.color)).toEqual(['cTime', 'cPlace']);
  });
});

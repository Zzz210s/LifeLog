/**
 * `drawPlan` 的关系边层(Task 5,设计 §8):`A --(B 的备注)--> B`。
 * 钉住四件事:
 * ① 关系边单独一层(`plan.relations`),带 `arrow: true` 标记 —— 与同色同宽的笔记链接边分层可辨;
 * ② 文字备注只在缩放 `k >= 1.2` 时画在**箭头中点**(低缩放只画箭头不画字);
 * ③ 备注缺失(空串)的目标不画字;
 * ④ 关系边参与悬停邻居强调:悬停一端,另一端进邻居集合,这条边 `emphasized`。
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { emphasisOf } from './graph-focus';
import { drawPlan } from './graph-draw-plan';
import type { RelationEdge } from './graph-relations';

const nodes: GraphNode[] = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 3, selfCount: 3, sortOrder: 0 },
  { id: 2, path: '乙', depth: 1, parent: null, notes: 1, selfCount: 1, sortOrder: 0 },
  { id: 3, path: '丙', depth: 1, parent: null, notes: 1, selfCount: 1, sortOrder: 0 },
];
const points = new Map([
  [1, { x: 50, y: 50 }],
  [2, { x: 300, y: 50 }],
  [3, { x: 50, y: 250 }],
]);
const relations: RelationEdge[] = [
  { a: 1, b: 2, remark: '属性' },
  { a: 1, b: 3, remark: '' }, // 目标没备注 -> 不画字
];
const base = {
  nodes,
  edges: [],
  points,
  cam: { k: 1, tx: 0, ty: 0 },
  w: 400,
  h: 300,
  rootColor: new Map<number, string>(),
  fallbackColor: 'c0',
  emphasis: emphasisOf({ selected: null, hovered: null, edges: [] }),
  relations,
};

describe('drawPlan:关系边层', () => {
  it('关系边进 plan.relations 且带箭头标记;note links 层不含它们', () => {
    const p = drawPlan({ ...base, links: [{ a: 1, b: 2 }] });
    expect(p.relations).toEqual([
      { x1: 50, y1: 50, x2: 300, y2: 50, weight: 1, emphasized: false, dim: false, arrow: true },
      { x1: 50, y1: 50, x2: 50, y2: 250, weight: 1, emphasized: false, dim: false, arrow: true },
    ]);
    expect(p.links).toEqual([]); // 笔记 id 与标签 id 不互相串层(link 的两端是笔记,这里没有展开)
  });

  it('k < 1.2 只画箭头不画备注;k >= 1.2 备注落在箭头中点', () => {
    expect(drawPlan({ ...base, cam: { k: 1, tx: 0, ty: 0 } }).relationMarks).toEqual([]);
    const hi = drawPlan({ ...base, cam: { k: 1.2, tx: 0, ty: 0 } });
    // 屏幕坐标 = 世界坐标 × 1.2:甲(60,60) 与 乙(360,60) 的中点是 (210,60)
    expect(hi.relationMarks).toEqual([{ x: 210, y: 60, text: '属性' }]); // 丙 的备注是空串 -> 不出
    expect(hi.relations).toHaveLength(2);
  });

  it('两端都在视口外的关系边丢弃,一端可见仍画(与其它边同口径)', () => {
    const far = new Map(points);
    far.set(9, { x: 100000, y: 100000 });
    far.set(10, { x: 200000, y: 200000 });
    const p = drawPlan({
      ...base,
      nodes: [
        ...nodes,
        { id: 9, path: '远/一', depth: 2, parent: 1, notes: 1, selfCount: 1, sortOrder: 0 },
        { id: 10, path: '远/二', depth: 2, parent: 1, notes: 1, selfCount: 1, sortOrder: 0 },
      ],
      points: far,
      relations: [
        { a: 9, b: 10, remark: '' }, // 两端都在画布外 -> 丢
        { a: 1, b: 9, remark: '' }, // 一端可见 -> 画
      ],
    });
    expect(p.relations).toHaveLength(1);
    expect(p.relations[0].x1).toBe(50);
  });

  it('关系边参与悬停邻居强调:悬停一端,另一端进邻居且这条边 emphasized', () => {
    const em = emphasisOf({ selected: null, hovered: 1, edges: [], relations });
    expect([...em.neighbors].sort()).toEqual([2, 3]);
    const p = drawPlan({ ...base, emphasis: em });
    expect(p.relations.every((s) => s.emphasized)).toBe(true);
    // 邻居点不弱化,无关点弱化
    expect(p.dots.find((d) => d.id === 2)!.dim).toBe(false);
    expect(p.dots.find((d) => d.id === 3)!.dim).toBe(false);
  });
});

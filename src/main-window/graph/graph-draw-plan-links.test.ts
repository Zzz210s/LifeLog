/**
 * `drawPlan` 的笔记间 link 层(L4):只在**两端笔记都在展开的扇形里**时画一条段。
 *
 * 钉住三件事:
 * ① 另一端看不见 / 自指 -> 不画(画出来就是飘在空处的线);
 * ② 没展开 -> 一条都没有(link 的两端是笔记,标签骨架这条路上它没有落点);
 * ③ `emphasized` / `dim` 恒 false —— 强调态的 active/selected 是**标签** id,笔记 id 撞上它
 *    也不该变粗/变暗(两套 id 数值相同很常见,让它们互相作用就是随机故障)。
 */
import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../shared/types';
import { NO_EMPHASIS, emphasisOf } from './graph-focus';
import { drawPlan } from './graph-draw-plan';

const nodes: GraphNode[] = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 3, selfCount: 3, sortOrder: 0 },
  { id: 2, path: '乙', depth: 1, parent: null, notes: 1, selfCount: 1, sortOrder: 0 },
];
const tagEdges: GraphEdge[] = [{ a: 1, b: 2, kind: 'co', weight: 1 }];
const points = new Map([
  [1, { x: 50, y: 50 }],
  [2, { x: 300, y: 50 }],
]);
const base = {
  nodes,
  edges: tagEdges,
  points,
  cam: { k: 1, tx: 0, ty: 0 },
  w: 400,
  h: 300,
  rootColor: new Map<number, string>(),
  fallbackColor: 'c0',
  emphasis: NO_EMPHASIS,
};

/** 展开标签 1:三个小圆(笔记 501/502/503)摆在屏幕坐标上 */
const expanded = {
  id: 1,
  space: 'screen' as const,
  dots: [
    { id: 501, x: 60, y: 200 },
    { id: 502, x: 100, y: 200 },
    { id: 503, x: 140, y: 200 },
  ],
  overflow: null,
};

describe('drawPlan:笔记间 link 边', () => {
  it('两端都在扇形里才画:另一端是别的标签的笔记时那条丢掉', () => {
    const p = drawPlan({
      ...base,
      expanded,
      links: [
        { a: 501, b: 502 },
        { a: 502, b: 503 },
        { a: 501, b: 999 }, // 999 不在展开的这圈小圆里
        { a: 502, b: 502 }, // 自指(写入侧已排除,这里再挡一道)
      ],
    });
    expect(p.links).toEqual([
      { x1: 60, y1: 200, x2: 100, y2: 200, weight: 1, emphasized: false, dim: false },
      { x1: 100, y1: 200, x2: 140, y2: 200, weight: 1, emphasized: false, dim: false },
    ]);
  });

  it('没展开 / 展开者被裁到视口外:link 一条都不画(没有落点)', () => {
    const links = [{ a: 501, b: 502 }];
    expect(drawPlan({ ...base, links }).links).toEqual([]);
    expect(drawPlan({ ...base, links, expanded: { ...expanded, id: 99 } }).links).toEqual([]);
  });

  it('弱化与强调:标签焦点再强也改不动 link 段(笔记 id 与标签 id 不互相作用)', () => {
    // 笔记 501 恰好与「被选中的标签」同数:它既不是 active 的邻居,也不该被当成强调边
    const em = emphasisOf({ selected: 501, hovered: null, edges: tagEdges });
    const p = drawPlan({ ...base, emphasis: em, expanded, links: [{ a: 501, b: 502 }] });
    expect(em.active).toBe(501);
    expect(p.links[0].emphasized).toBe(false);
    expect(p.links[0].dim).toBe(false);
    // 焦点真的生效了(不是没传进来):两个标签点都被弱化
    expect(p.dots.filter((d) => d.dim)).toHaveLength(2);
    // 边也不受影响:这条共现边与 501 无关,按老口径照旧弱化
    expect(p.co[0].dim).toBe(true);
  });
});

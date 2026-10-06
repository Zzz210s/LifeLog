/**
 * `drawPlan` 的关系边层(Task 5,设计 §8):`A --(B 的备注)--> B`。
 * 钉住四件事:
 * ① 关系边单独一层(`plan.relations`),带 `arrow: true` 标记 —— 与同色同宽的笔记链接边分层可辨;
 * ② 文字备注只在缩放 `k >= 0.6`(即尚未进入聚合档)**且该边端点就是当前焦点**(悬停/选中该标签)时画在箭头附近;
 *    平时只画箭头不画字;进入聚合档(k < 0.6)即使悬停了也不画字;
 * ③ 备注缺失(空串)的目标不画字;
 * ④ 关系边参与悬停邻居强调:悬停一端,另一端进邻居集合,这条边 `emphasized`。
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { emphasisOf } from './graph-focus';
import { drawPlan } from './graph-draw-plan';
import { ARROW_RETREAT_GAP, radiusOf } from './graph-draw-plan-metrics';
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

/** 悬停 1(甲):它是两条关系边的端点 -> 那两条边的属性名可显示 */
const hover1 = (): ReturnType<typeof emphasisOf> => emphasisOf({ selected: null, hovered: 1, edges: [], relations });

describe('drawPlan:关系边层', () => {
  it('关系边进 plan.relations 且带箭头标记;note links 层不含它们', () => {
    const p = drawPlan({ ...base, links: [{ a: 1, b: 2 }] });
    expect(p.relations).toEqual([
      { x1: 50, y1: 50, x2: 300, y2: 50, weight: 1, emphasized: false, dim: false, arrow: true, pullback: radiusOf(1) + ARROW_RETREAT_GAP },
      { x1: 50, y1: 50, x2: 50, y2: 250, weight: 1, emphasized: false, dim: false, arrow: true, pullback: radiusOf(1) + ARROW_RETREAT_GAP },
    ]);
    expect(p.links).toEqual([]); // 笔记 id 与标签 id 不互相串层(link 的两端是笔记,这里没有展开)
  });

  it('箭头回收量按**目标半径**给:目标越粗回收越远(W1)', () => {
    const fat: GraphNode[] = [
      { id: 1, path: '甲', depth: 1, parent: null, notes: 3, selfCount: 3, sortOrder: 0 },
      { id: 2, path: '乙', depth: 1, parent: null, notes: 1000, selfCount: 1000, sortOrder: 0 },
    ];
    const p = drawPlan({
      ...base,
      nodes: fat,
      points: new Map([[1, { x: 50, y: 50 }], [2, { x: 300, y: 50 }]]),
      relations: [{ a: 1, b: 2, remark: '' }],
    });
    // 乙 的半径到上限 9,回收量应当是 9 + 余量,而不是固定值
    expect(p.relations[0].pullback).toBe(9 + ARROW_RETREAT_GAP);
    expect(p.relations[0].pullback).toBeGreaterThan(radiusOf(1) + ARROW_RETREAT_GAP);
  });

  it('平时(无焦点)只画箭头不画属性名;悬停端点且 k >= 0.6(未进聚合档)就出备注', () => {
    // 平时:箭头仍在,属性名一个都不画
    const idle = drawPlan({ ...base, cam: { k: 1.2, tx: 0, ty: 0 } });
    expect(idle.relationMarks).toEqual([]);
    expect(idle.relations).toHaveLength(2);
    // 聚合档(k < 0.6):没有单条边了,即使悬停了也不画字
    expect(drawPlan({ ...base, cam: { k: 0.55, tx: 0, ty: 0 }, emphasis: hover1() }).relationMarks).toEqual([]);
    // 0.7 档(旧 0.8 阈值之下):悬停端点就出字 —— 阈值不再挡住已画出的单条边
    expect(
      drawPlan({ ...base, cam: { k: 0.7, tx: 0, ty: 0 }, emphasis: hover1() }).relationMarks.map((m) => m.text)
    ).toEqual(['属性']);
    // 聚合阈值边界 k = 0.6:仍算单条边,出字
    expect(
      drawPlan({ ...base, cam: { k: 0.6, tx: 0, ty: 0 }, emphasis: hover1() }).relationMarks.map((m) => m.text)
    ).toEqual(['属性']);
    // 悬停端点 + k 够大:备注沿箭头法线错开
    const hi = drawPlan({ ...base, cam: { k: 0.8, tx: 0, ty: 0 }, emphasis: hover1() });
    // 屏幕坐标 = 世界坐标 × 0.8:甲(50,50) 与 乙(300,50) 的中点是 (140,40),
    // 法线方向 (0,1),错开 9px -> (140,49);弱化态跟随这条边
    expect(hi.relationMarks).toEqual([{ x: 140, y: 49, text: '属性', dim: false }]); // 丙 的备注是空串 -> 不出
    expect(hi.relations).toHaveLength(2);
  });

  it('选中该标签(未悬停)也出备注:emphasis.active = selected 时同样显示', () => {
    const em = emphasisOf({ selected: 1, hovered: null, edges: [], relations });
    const p = drawPlan({ ...base, cam: { k: 1.2, tx: 0, ty: 0 }, emphasis: em });
    expect(p.relationMarks.map((m) => m.text)).toEqual(['属性']);
  });

  it('备注里的行内 md 标记剥成纯文本再画', () => {
    const p = drawPlan({
      ...base,
      cam: { k: 1.2, tx: 0, ty: 0 },
      emphasis: hover1(),
      relations: [{ a: 1, b: 2, remark: '**属性**' }],
    });
    expect(p.relationMarks).toEqual([{ x: 210, y: 69, text: '属性', dim: false }]);
  });

  it('悬停不相干的节点:一条备注都不出(属性名只在悬停/选中该标签时出现)', () => {
    // 4 与任何节点都没有关系 -> 悬停它时不该冒出别人的属性名
    const withDing: GraphNode[] = [
      ...nodes,
      { id: 4, path: '丁', depth: 1, parent: null, notes: 1, selfCount: 1, sortOrder: 0 },
    ];
    const withDingPoints = new Map(points);
    withDingPoints.set(4, { x: 300, y: 250 });
    const p = drawPlan({
      ...base,
      nodes: withDing,
      points: withDingPoints,
      cam: { k: 1.2, tx: 0, ty: 0 },
      emphasis: emphasisOf({ selected: null, hovered: 4, edges: [], relations }),
    });
    expect(p.relationMarks).toEqual([]);
    // 悬停 1(端点):同一条边的备注回来,且不被弱化
    const linked = drawPlan({
      ...base,
      cam: { k: 1.2, tx: 0, ty: 0 },
      emphasis: hover1(),
    });
    expect(linked.relationMarks.find((m) => m.text === '属性')!.dim).toBe(false);
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

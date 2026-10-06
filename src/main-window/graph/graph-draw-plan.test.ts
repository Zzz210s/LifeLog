import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../shared/types';
import { NO_EMPHASIS, emphasisOf } from './graph-focus';
import { drawPlan } from './graph-draw-plan';

/**
 * 夹具说明(与计划原文的差异已按事实修正):节点 3「地点」的笔记数取 12,不是 779。
 * 计划里 LOD 中档用例期望只有 [1, 2] 出文字,可 779 >= 100 会让节点 3 也算枢纽;
 * 且 779 与 1177 的半径都撞上限 9,「点大小随笔记数增长」会因两者相等而红。
 */
const nodes: GraphNode[] = [
  { id: 1, path: '时间', depth: 1, parent: null, notes: 1177, selfCount: 137, sortOrder: 0 },
  { id: 2, path: '时间/日期', depth: 2, parent: 1, notes: 1040, selfCount: 1040, sortOrder: 0 },
  { id: 3, path: '地点', depth: 1, parent: null, notes: 12, selfCount: 12, sortOrder: 0 },
];
const edges: GraphEdge[] = [
  { a: 1, b: 2, kind: 'tree', weight: 1 },
  { a: 1, b: 3, kind: 'co', weight: 12 },
];
const points = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 100, y: 0 }],
  [3, { x: 0, y: 100 }],
]);
const cam = { k: 1, tx: 200, ty: 150 };
const base = {
  nodes,
  edges,
  points,
  cam,
  w: 400,
  h: 300,
  rootColor: new Map([
    [1, 'c1'],
    [2, 'c1'],
    [3, 'c2'],
  ]),
  fallbackColor: 'c0',
  emphasis: NO_EMPHASIS,
};

describe('drawPlan:决定画什么(纯函数)', () => {
  it('边按类型分层,父子边进 tree、共现边进 co', () => {
    const p = drawPlan(base);
    expect(p.tree).toHaveLength(1);
    expect(p.co).toHaveLength(1);
    expect(p.tree[0]).toEqual({ x1: 200, y1: 150, x2: 300, y2: 150, weight: 1, emphasized: false, dim: false });
  });

  it('LOD:缩小到 0.5 时不出文字,放大到 1.5 时每个可见节点都有文字', () => {
    expect(drawPlan({ ...base, cam: { k: 0.5, tx: 200, ty: 150 } }).labels).toHaveLength(0);
    expect(
      drawPlan({ ...base, cam: { k: 1.5, tx: 200, ty: 150 } })
        .labels.map((l) => l.id)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  it('LOD 中档只出枢纽文字(notes >= 100),文字取末级段名', () => {
    const p = drawPlan(base); // k = 1
    expect(p.labels.map((l) => l.id).sort()).toEqual([1, 2]);
    expect(p.labels.find((l) => l.id === 2)!.text).toBe('日期');
    // 文字画在点的上方(半径 + 4)
    const dot = p.dots.find((d) => d.id === 2)!;
    expect(p.labels.find((l) => l.id === 2)!.y).toBe(dot.y - dot.r - 4);
  });

  it('LOD 中档阈值就钉在 100:99 条不算枢纽,100 条算', () => {
    const one = (notes: number) =>
      drawPlan({
        ...base,
        nodes: [{ id: 1, path: '甲/乙', depth: 2, parent: null, notes, selfCount: notes, sortOrder: 0 }],
        edges: [],
        points: new Map([[1, { x: 0, y: 0 }]]),
        rootColor: new Map([[1, 'c1']]),
      });
    expect(one(100).labels.map((l) => l.id)).toEqual([1]);
    expect(one(99).labels).toHaveLength(0);
  });

  it('节点文字剥掉行内 md(与备注同一口径,W3)', () => {
    const p = drawPlan({
      ...base,
      nodes: [{ id: 1, path: '地点轴/[国籍](国别)', depth: 2, parent: null, notes: 200, selfCount: 200, sortOrder: 0 }],
      edges: [],
      points: new Map([[1, { x: 0, y: 0 }]]),
      rootColor: new Map([[1, 'c1']]),
    });
    expect(p.labels[0].text).toBe('国籍');
  });

  it('视口裁剪:画布外的节点不进 dots;两端都在视口外的边丢弃,一端可见的仍画', () => {
    const farPoints = new Map(points);
    farPoints.set(9, { x: 100000, y: 100000 });
    farPoints.set(10, { x: 200000, y: 200000 });
    const p = drawPlan({
      ...base,
      nodes: [
        ...nodes,
        { id: 9, path: '远/一', depth: 2, parent: 1, notes: 1, selfCount: 1, sortOrder: 0 },
        { id: 10, path: '远/二', depth: 2, parent: 1, notes: 1, selfCount: 1, sortOrder: 0 },
      ],
      edges: [
        ...edges,
        { a: 9, b: 10, kind: 'co', weight: 1 }, // 两端都在画布外 -> 丢
        { a: 1, b: 9, kind: 'co', weight: 2 }, // 一端可见 -> 画
      ],
      points: farPoints,
    });
    expect(p.dots.map((d) => d.id)).not.toContain(9);
    expect(p.co).toHaveLength(2);
    // 位置缺失的边也跳过(布局没覆盖到该点)
    const missing = drawPlan({ ...base, points: new Map([[1, { x: 0, y: 0 }]]) });
    expect(missing.tree).toHaveLength(0);
    expect(missing.co).toHaveLength(0);
    expect(missing.dots.map((d) => d.id)).toEqual([1]);
  });

  it('点大小随笔记数增长但有上限', () => {
    const p = drawPlan(base);
    const big = p.dots.find((d) => d.id === 1)!;
    const small = p.dots.find((d) => d.id === 3)!;
    expect(big.r).toBeGreaterThan(small.r);
    expect(big.r).toBe(9); // 1177 条笔记已撞上限
    expect(small.r).toBeLessThan(9);
  });

  it('颜色只由入参决定:命中的用 rootColor,缺项退回 fallbackColor', () => {
    const p = drawPlan(base);
    expect(p.dots.find((d) => d.id === 1)!.color).toBe('c1');
    expect(p.dots.find((d) => d.id === 3)!.color).toBe('c2');
    const plain = drawPlan({ ...base, rootColor: new Map() });
    expect(plain.dots.map((d) => d.color)).toEqual(['c0', 'c0', 'c0']);
  });
});

describe('drawPlan:强调态', () => {
  it('焦点与邻居之外的点标 dim,焦点与邻居不 dim', () => {
    // 悬停 2:active = 2,邻居 = {1};1 号是选中点、2 号是焦点,3 号谁也不沾 -> 暗
    const p = drawPlan({ ...base, emphasis: emphasisOf({ selected: 1, hovered: 2, edges }) });
    expect(p.dots.find((d) => d.id === 3)!.dim).toBe(true);
    expect(p.dots.find((d) => d.id === 1)!.dim).toBe(false);
    expect(p.dots.find((d) => d.id === 2)!.dim).toBe(false);
  });

  it('选中环跟 selected 走,不跟焦点走', () => {
    const p = drawPlan({ ...base, emphasis: emphasisOf({ selected: 1, hovered: 3, edges }) });
    expect(p.dots.find((d) => d.id === 1)!.selected).toBe(true);
    expect(p.dots.find((d) => d.id === 3)!.selected).toBe(false); // 焦点也不会被当成选中
    expect(p.dots.find((d) => d.id === 3)!.dim).toBe(false);
  });

  it('边的 dim:只要有一端暗,这条边就暗', () => {
    const p = drawPlan({ ...base, emphasis: emphasisOf({ selected: null, hovered: 2, edges }) });
    // active = 2,邻居 = {1};tree 边 1-2 两端都亮,co 边 1-3 的 3 端暗
    expect(p.tree[0].dim).toBe(false);
    expect(p.co[0].dim).toBe(true);
  });

  it('强调边:任一端是当前焦点(active)的边标 emphasized,其余不标', () => {
    // 悬停 2 -> active = 2:边 1-2 连着它,边 1-3 不连;无悬停时 active 落到选中点 1
    const p = drawPlan({ ...base, emphasis: emphasisOf({ selected: 1, hovered: 2, edges }) });
    expect([p.tree[0].emphasized, p.co[0].emphasized]).toEqual([true, false]);
    const sel = drawPlan({ ...base, emphasis: emphasisOf({ selected: 1, hovered: null, edges }) });
    expect(sel.tree[0].emphasized && sel.co[0].emphasized).toBe(true);
  });

  it('没有强调时谁都不 dim(旧行为不变)', () => {
    const p = drawPlan({ ...base, emphasis: emphasisOf({ selected: null, hovered: null, edges }) });
    expect(p.dots.every((d) => !d.dim)).toBe(true);
    expect(p.dots.every((d) => !d.selected)).toBe(true);
    expect(p.co.every((s) => !s.dim)).toBe(true);
    expect(p.tree.every((s) => !s.dim)).toBe(true);
  });
});

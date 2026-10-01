/**
 * `drawPlan` 的展开笔记层(G3 Task 5 起口径显式):世界口径过相机换算,屏幕口径**原样**画。
 * 从 graph-draw-plan.test.ts 分出来是守 200 行红线;夹具与原文件同一份形状。
 */
import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../shared/types';
import { screenOf } from './graph-camera';
import { NO_EMPHASIS, emphasisOf } from './graph-focus';
import { drawPlan } from './graph-draw-plan';
import { noteFan } from './graph-notes';

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
const base = {
  nodes,
  edges,
  points,
  cam: { k: 1, tx: 200, ty: 150 },
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

describe('drawPlan:展开的笔记小圆', () => {
  /** 世界口径的展开层:点与半径都是世界坐标,由 drawPlan 过相机 */
  const expandedWorld = {
    id: 2,
    space: 'world' as const,
    dots: [
      { x: 100, y: 0 },
      { x: 100, y: 20 },
    ],
    overflow: { id: 2, x: 100, y: 0, n: 5 },
  };

  it('世界口径的展开层进相机换算,节点默认不展开', () => {
    expect(drawPlan(base).notes).toEqual([]);
    expect(drawPlan(base).overflow).toBe(null);

    const p = drawPlan({ ...base, expanded: expandedWorld });
    // cam = { k: 1, tx: 200, ty: 150 }
    expect(p.notes).toEqual([
      { x: 300, y: 150 },
      { x: 300, y: 170 },
    ]);
    // `+N` 过相机换算之后仍带着所属标签的 id(命中要用它,不能只留坐标)
    expect(p.overflow).toEqual({ id: 2, x: 300, y: 150, n: 5 });
  });

  it('屏幕口径不再换算:k=0.2 时小圆与标签点的屏幕距离不缩(改回世界口径立刻红)', () => {
    const cam = { k: 0.2, tx: 200, ty: 150 };
    const nodeWorld = points.get(2)!; // 世界坐标 (100, 0)
    const center = screenOf(nodeWorld, cam); // 标签点的屏幕位置
    const r = 17;

    // G3 起 use-expanded-notes 就是把「屏幕圆心 + 屏幕半径」递进来的
    const dots = noteFan({ center, count: 6, radius: r, space: 'screen' }).dots;
    const screen = drawPlan({ ...base, cam, expanded: { id: 2, space: 'screen', dots, overflow: null } });
    expect(screen.notes).toHaveLength(6);
    for (const d of screen.notes) expect(Math.hypot(d.x - center.x, d.y - center.y)).toBeCloseTo(r, 6);

    // 旧口径(世界):同一半径 17 被 k=0.2 一缩 -> 只剩 3.4px,整圈缩进标签点里
    const worldDots = noteFan({ center: nodeWorld, count: 6, radius: r, space: 'world' }).dots;
    const world = drawPlan({ ...base, cam, expanded: { id: 2, space: 'world', dots: worldDots, overflow: null } });
    expect(Math.hypot(world.notes[0].x - center.x, world.notes[0].y - center.y)).toBeCloseTo(r * 0.2, 6);
  });

  it('展开的节点被视口裁掉时,整组笔记与 +N 都不画(不留孤儿小圆)', () => {
    const far = drawPlan({ ...base, expanded: { ...expandedWorld, id: 99 } });
    expect(far.notes).toEqual([]);
    expect(far.overflow).toBe(null);
  });

  it('笔记小圆不参与弱化:dim 由点与边自己带,plan 的 notes 不带标志', () => {
    const p = drawPlan({ ...base, emphasis: emphasisOf({ selected: 1, hovered: null, edges }), expanded: expandedWorld });
    expect(p.notes).toHaveLength(2); // 展开者是被主动点开的,永远清晰
  });
});

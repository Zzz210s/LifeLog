/**
 * 力导向一步的纯数学证据:斥力推开、弹簧拉近、锚点不动、收敛判据,
 * 外加网格分桶的边界(非邻桶不互斥 —— 这正是不做 O(n²) 的代价与收益)与输入不被改写。
 * 阻尼衰减 / 每帧预算 / 停手时机在 use-force-layout.dom.test.ts。
 */
import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '../../shared/types';
import { forceStep, isConverged } from './force-layout';
import type { Point } from './radial';

const points: Map<number, Point> = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 1, y: 0 }],
  [3, { x: 0, y: 1 }],
]);
const tree: GraphEdge[] = [{ a: 1, b: 2, kind: 'tree', weight: 1 }];

const dist = (m: Map<number, Point>, a: number, b: number): number =>
  Math.hypot(m.get(a)!.x - m.get(b)!.x, m.get(a)!.y - m.get(b)!.y);

const step = (input: { points: Map<number, Point>; edges?: GraphEdge[]; anchors?: number[]; alpha?: number }) =>
  forceStep({
    points: input.points,
    edges: input.edges ?? [],
    anchors: new Set(input.anchors ?? []),
    alpha: input.alpha ?? 1,
    grid: 64,
  });

describe('forceStep:一步力导向', () => {
  it('互相靠近的节点被推开(斥力)', () => {
    const next = step({ points });
    expect(dist(next, 1, 2)).toBeGreaterThan(dist(points, 1, 2));
    expect(dist(next, 1, 3)).toBeGreaterThan(dist(points, 1, 3));
  });

  it('有边的两点被拉近(弹簧)', () => {
    const far: Map<number, Point> = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 500, y: 0 }],
    ]);
    const next = step({ points: far, edges: tree });
    expect(Math.abs(next.get(2)!.x)).toBeLessThan(500);
    expect(next.get(1)!.x).toBeGreaterThan(0); // 另一端也被拉过去(力是成对的)
  });

  it('锚点(拖过的节点)不动:坐标原样返回', () => {
    const next = step({ points, edges: tree, anchors: [1] });
    expect(next.get(1)).toBe(points.get(1));
    expect(next.get(2)).not.toEqual(points.get(2)); // 别人照旧受力
  });

  it('单步位移夹在 MAX_STEP 内:斥力在 d→0 时不会把点炸飞', () => {
    const next = step({ points }); // d(1,2) = 1,未夹取时斥力 5000
    expect(dist(next, 1, 2)).toBeLessThan(24 * 2 + 1);
  });

  it('输入不被改写(纯函数)', () => {
    const before = [...points].map(([id, p]) => [id, { ...p }] as const);
    step({ points, edges: tree, anchors: [3] });
    expect([...points]).toEqual(before);
  });

  it('网格分桶:非邻桶之间不算斥力(原点的点纹丝不动,不被远处点推动)', () => {
    const two: Map<number, Point> = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 200, y: 0 }],
    ]); // 格 0,0 与 3,0:不相邻
    const next = step({ points: two });
    expect(next.get(1)).toEqual({ x: 0, y: 0 });
    expect(next.get(2)!.x).toBeLessThan(200); // 只受向心
  });

  it('网格分桶:相邻桶之间照旧互斥', () => {
    const two: Map<number, Point> = new Map([
      [1, { x: 63, y: 0 }],
      [2, { x: 65, y: 0 }],
    ]); // 格 0,0 与 1,0:相邻
    const next = step({ points: two });
    expect(dist(next, 1, 2)).toBeGreaterThan(2);
  });
});

describe('isConverged:收敛判据', () => {
  it('最大位移小于 eps 即收敛;有一点超过就不算', () => {
    const near: Map<number, Point> = new Map([
      [1, { x: 0.001, y: 0 }],
      [2, { x: 1, y: 0 }],
      [3, { x: 0, y: 1 }],
    ]);
    expect(isConverged(points, near, 0.01)).toBe(true);
    const far: Map<number, Point> = new Map([
      [1, { x: 5, y: 0 }],
      [2, { x: 1, y: 0 }],
      [3, { x: 0, y: 1 }],
    ]);
    expect(isConverged(points, far, 0.01)).toBe(false);
  });

  it('缺点不算收敛(不能被缺项糊弄成"静止")', () => {
    const missing: Map<number, Point> = new Map([[1, { x: 0, y: 0 }]]);
    expect(isConverged(points, missing, 0.01)).toBe(false);
  });
});

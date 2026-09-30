import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { NO_EMPHASIS } from './graph-focus';
import { drawPlan, radiusOf } from './graph-draw-plan';
import { HIT_SLOP, hitTest } from './graph-hit';

const nodes: GraphNode[] = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 4, selfCount: 0, sortOrder: 0 },
  { id: 2, path: '甲/一', depth: 2, parent: 1, notes: 1, selfCount: 1, sortOrder: 0 },
];
const points = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 100, y: 0 }],
]);
const cam = { k: 1, tx: 200, ty: 150 };
const at = (x: number, y: number) => hitTest({ nodes, points, cam, x, y });

describe('hitTest:屏幕坐标 -> 节点', () => {
  it('圆心附近命中', () => {
    expect(at(200, 150)).toBe(1);
    expect(at(300, 150)).toBe(2);
  });

  it('半径外不命中(半径 = f(笔记数) + 4px 容差)', () => {
    expect(at(200 + 40, 150)).toBe(null);
  });

  it('两个都命中时取最近', () => {
    const close = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 10, y: 0 }],
    ]);
    expect(hitTest({ nodes, points: close, cam, x: 212, y: 150 })).toBe(2);
  });

  it('缩放后仍以屏幕圆心命中(相机 k 只挪位置,不改半径)', () => {
    const zoomed = { k: 4, tx: 0, ty: 0 };
    expect(hitTest({ nodes, points, cam: zoomed, x: 0, y: 0 })).toBe(1);
  });
});

// 计划给的 4 条里,第 3/4 条的取值落在圆心上,「取最近」这条口径其实没被真正区分开
// (实现改成"先遇到的"它照样绿)。以下三条补齐。
describe('hitTest 边界(自补)', () => {
  it('三个都在容差内时取最近(既不是先遇到的也不是后遇到的)', () => {
    const same: GraphNode[] = [10, 11, 12].map((id, i) => ({
      id,
      path: `p${id}`,
      depth: 1,
      parent: null,
      notes: 4,
      selfCount: 0,
      sortOrder: i,
    }));
    const row = new Map([
      [10, { x: 0, y: 0 }],
      [11, { x: 6, y: 0 }],
      [12, { x: 12, y: 0 }],
    ]);
    // r(4) = 3、容差 4 -> 触及半径 7;光标落在 11 的圆心上,三者都在 7 以内
    expect(hitTest({ nodes: same, points: row, cam, x: 206, y: 150 })).toBe(11);
  });

  it('命中区与缩放无关:点的屏幕半径不随 k 变', () => {
    // r(4) = min(9, 2.5 + sqrt(4)/4) = 3(已是屏幕像素);容差 4 -> 7px 内命中、8px 外不命中
    for (const k of [0.2, 1, 4]) {
      const cam = { k, tx: 0, ty: 0 };
      expect(hitTest({ nodes, points, cam, x: 6, y: 0 })).toBe(1);
      expect(hitTest({ nodes, points, cam, x: 8, y: 0 })).toBe(null);
    }
  });

  it('触及半径含等号:恰好在 7px 上算命中,再多 1px 不算', () => {
    // 屏幕圆心(200,150),r(4)=3 -> 触及半径 7:落在边界上必须命中(> 与 >= 只差这一格)
    expect(at(207, 150)).toBe(1);
    expect(at(208, 150)).toBe(null);
  });

  it('布局里没有位置的节点直接跳过', () => {
    const partial = new Map([[1, { x: 0, y: 0 }]]);
    expect(hitTest({ nodes, points: partial, cam, x: 300, y: 150 })).toBe(null);
  });

  it('radiusOf 只有一份定义:导出值与画的半径逐点相同,并封顶 9', () => {
    const plan = drawPlan({
      nodes,
      edges: [],
      points,
      cam,
      w: 400,
      h: 300,
      rootColor: new Map(),
      fallbackColor: 'c0',
      emphasis: NO_EMPHASIS,
    });
    for (const d of plan.dots) {
      const n = nodes.find((x) => x.id === d.id)!;
      expect(d.r).toBe(radiusOf(n.notes));
    }
    expect(radiusOf(4)).toBe(3);
    expect(radiusOf(10_000)).toBe(9);
    expect(HIT_SLOP).toBe(4);
  });
});

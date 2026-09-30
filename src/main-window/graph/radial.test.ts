import { describe, expect, it, vi } from 'vitest';
import { radialLayout } from './radial';
import type { GraphNode } from '../../shared/types';

const n = (id: number, depth: number, parent: number | null, notes = 0): GraphNode => ({
  id, path: `p${id}`, depth, parent, notes, selfCount: notes, sortOrder: 0,
});

/** 两个角度的最小夹角(atan2 值域 (-π, π],跨 ±π 的角要按 2π 取补) */
const sep = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(d, Math.PI * 2 - d);
};

describe('radialLayout:根在内圈、非根半径 = (depth-1)*layerGap、角度按子树大小', () => {
  it('根落在内圈 0.35*layerGap(不叠在圆心),非根半径 = (depth - 1) * layerGap', () => {
    const pos = radialLayout([n(1, 1, null), n(2, 2, 1)], { layerGap: 100 });
    const root = pos.get(1)!;
    expect(Math.round(Math.hypot(root.x, root.y))).toBe(35);
    const p2 = pos.get(2)!;
    expect(Math.round(Math.hypot(p2.x, p2.y))).toBe(100);
  });

  it('子树大的分支占更大角度(避免 49% 的时间轴被挤扁)', () => {
    // 根 1 下:分支 A(2 -> 3,4 两个子,子树 3 个)与分支 B(5,子树 1 个)
    const nodes = [n(1, 1, null), n(2, 2, 1), n(3, 3, 2), n(4, 3, 2), n(5, 2, 1)];
    const pos = radialLayout(nodes, { layerGap: 10 });
    const ang = (id: number) => Math.atan2(pos.get(id)!.y, pos.get(id)!.x);
    // A 的中点角与 B 的角度差应接近 2:1 的扇区划分(A 占 3/4 圈,B 占 1/4)
    const gap = sep(ang(2), ang(5));
    expect(gap).toBeGreaterThan(Math.PI / 2);
    // B 的子树只占 1/4 圈(0.5π),它自己的中点角就在该扇区中心 0.25π 处(均分会落到 0.5π)
    expect(sep(ang(5), 0)).toBeCloseTo(Math.PI / 4, 6);
    // A 的两个子孙各占 0.75π 扇区,中点角相隔 0.75π(均分只有 0.5π)
    expect(sep(ang(3), ang(4))).toBeCloseTo(Math.PI * 0.75, 6);
  });

  it('多根且子树不等时,扇区按各自子树大小分(根层这条线也要有齿)', () => {
    // 根 1 子树 2(1,2)、根 9 子树 4(9,91,92,93) -> 总 6,根 1 应占 2/6 圈,中点角 π/3
    const nodes = [n(1, 1, null), n(2, 2, 1), n(9, 1, null), n(91, 2, 9), n(92, 2, 9), n(93, 2, 9)];
    const pos = radialLayout(nodes, { layerGap: 10 });
    const p2 = pos.get(2)!;
    expect(Math.atan2(p2.y, p2.x)).toBeCloseTo(Math.PI / 3, 6);
  });

  it('layerGap 为 0 时坐标是 0 而不是 -0(cos(π)·0 === -0,toEqual 区分 ±0)', () => {
    const pos = radialLayout([n(1, 1, null), n(2, 2, 1)], { layerGap: 0 });
    expect(pos.get(1)).toEqual({ x: 0, y: 0 });
    expect(pos.get(2)).toEqual({ x: 0, y: 0 });
  });

  it('结果可复现:同输入两次布局逐点相等', () => {
    const nodes = [n(1, 1, null), n(2, 2, 1), n(3, 2, 1)];
    expect(radialLayout(nodes, { layerGap: 10 })).toEqual(radialLayout(nodes, { layerGap: 10 }));
  });

  it('孤立节点(父级不可见)也落在自己深度的圈上,不抛错', () => {
    const pos = radialLayout([n(1, 1, null), n(9, 3, 999)], { layerGap: 50 });
    expect(Math.round(Math.hypot(pos.get(9)!.x, pos.get(9)!.y))).toBe(100);
  });

  it('成环/自指的点落不了位:不抛错,console.warn 提示', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 节点 3 自指(父就是自己),父在可见集合里 -> 不是根,整个 DFS 到不了它
    const pos = radialLayout([n(1, 1, null), n(2, 2, 1), n(3, 1, 3)], { layerGap: 10 });
    expect(pos.size).toBe(2);
    expect(pos.has(3)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

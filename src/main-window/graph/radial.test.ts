import { describe, expect, it } from 'vitest';
import { radialLayout } from './radial';
import type { GraphNode } from '../../shared/types';

const n = (id: number, depth: number, parent: number | null, notes = 0): GraphNode => ({
  id, path: `p${id}`, depth, parent, notes,
});

/** 两个角度的最小夹角(atan2 值域 (-π, π],跨 ±π 的角要按 2π 取补) */
const sep = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(d, Math.PI * 2 - d);
};

describe('radialLayout:根在中心、深度=半径、角度按子树大小', () => {
  it('根在原点,子节点半径 = depth * layerGap', () => {
    const pos = radialLayout([n(1, 1, null), n(2, 2, 1)], { layerGap: 100 });
    const root = pos.get(1)!;
    // 半径为 0 时 cos(π)·0 得到 -0(数值上等于 0);vitest 的 toEqual 区分 ±0,故按数值断言
    expect(root.x === 0 && root.y === 0).toBe(true);
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

  it('结果可复现:同输入两次布局逐点相等', () => {
    const nodes = [n(1, 1, null), n(2, 2, 1), n(3, 2, 1)];
    expect(radialLayout(nodes, { layerGap: 10 })).toEqual(radialLayout(nodes, { layerGap: 10 }));
  });

  it('孤立节点(父级不可见)也落在自己深度的圈上,不抛错', () => {
    const pos = radialLayout([n(1, 1, null), n(9, 3, 999)], { layerGap: 50 });
    expect(Math.round(Math.hypot(pos.get(9)!.x, pos.get(9)!.y))).toBe(100);
  });
});

import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { axisSlots, GRAPH_COLOR_SLOTS, nodeColors, rootAxisOf } from './graph-palette';

const node = (id: number, path: string): GraphNode => ({
  id, path, depth: path.split('/').length - 1, parent: null, notes: 1, selfCount: 1, sortOrder: id,
});

describe('rootAxisOf', () => {
  it('取第一段;没有斜杠时整串就是根轴', () => {
    expect(rootAxisOf('时间/日期/2026')).toBe('时间');
    expect(rootAxisOf('地点')).toBe('地点');
  });
});

describe('axisSlots', () => {
  it('根轴排序稳定:同一份数据每次得到同样的色档', () => {
    const a = axisSlots([node(1, '时间/x'), node(2, '地点/y')]);
    const b = axisSlots([node(9, '地点/y'), node(8, '时间/x')]);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('超过 8 个根轴时回绕', () => {
    const many = Array.from({ length: 10 }, (_, i) => node(i + 1, `轴${i}/x`));
    const slots = axisSlots(many);
    expect(slots.size).toBe(10);
    expect(Math.max(...slots.values())).toBe(GRAPH_COLOR_SLOTS - 1);
    expect([...slots.values()].filter((v) => v === 0).length).toBe(2); // 第 9 个回绕到 0
  });
});

describe('nodeColors', () => {
  it('同一根轴下的节点同色,不同根不同色', () => {
    const nodes = [node(1, '时间/a'), node(2, '时间/b'), node(3, '地点/c')];
    const colors = nodeColors(nodes, (slot) => `c${slot}`);
    expect(colors.get(1)).toBe(colors.get(2));
    expect(colors.get(1)).not.toBe(colors.get(3));
  });

  it('颜色按档缓存:同一档只读一次令牌', () => {
    let reads = 0;
    nodeColors([node(1, '时间/a'), node(2, '时间/b'), node(3, '地点/c')], (slot) => {
      reads += 1;
      return `c${slot}`;
    });
    expect(reads).toBe(2);
  });

  it('空输入返回空表', () => {
    expect(nodeColors([], () => 'x').size).toBe(0);
  });
});

describe('轴大小决定色档(2026-10-04 返工)', () => {
  it('节点最多的轴拿 0 档(色板顺序是平静 -> 醒目)', () => {
    const nodes = [
      node(1, '大轴/a'), node(2, '大轴/b'), node(3, '大轴/c'),
      node(4, '小轴/a'), node(5, '小轴/b'),
      node(6, '微轴/a'),
    ];
    const slots = axisSlots(nodes);
    expect(slots.get('大轴')).toBe(0);
    expect(slots.get('小轴')).toBe(1);
    expect(slots.get('微轴')).toBe(2);
  });

  it('数量相同时按轴名排序(着色稳定)', () => {
    const a = axisSlots([node(1, '甲/a'), node(2, '乙/a')]);
    const b = axisSlots([node(9, '乙/a'), node(8, '甲/a')]);
    expect(a.get('甲')).toBe(b.get('甲'));
  });
});

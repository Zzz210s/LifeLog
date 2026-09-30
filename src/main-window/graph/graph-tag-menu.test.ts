/**
 * 图节点 -> 标签菜单形状的适配器:字段逐项对齐,别名/大小写一处都不能漂
 * (`TagCount` 是后端口径的 snake_case,写错不会报错,只会让菜单的候选与计数静默变空)。
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { clampMenuPos, toManagedNode, toTagCount } from './graph-tag-menu';

const n: GraphNode = {
  id: 12,
  path: '地点/所在/中国',
  depth: 3,
  parent: 1,
  notes: 414,
  selfCount: 3,
  sortOrder: 5,
};

describe('图节点 -> 标签菜单所需的形状', () => {
  it('ManagedNode:name 取末级段', () => {
    const m = toManagedNode(n);
    expect(m.id).toBe(12);
    expect(m.name).toBe('中国');
    expect(m.depth).toBe(3);
    expect(m.selfCount).toBe(3);
    expect(m.subtreeCount).toBe(414);
    expect(m.sortOrder).toBe(5);
    expect(m.children).toEqual([]);
  });

  it('TagCount:snake_case 字段对齐后端口径', () => {
    expect(toTagCount(n)).toEqual({
      id: 12,
      path: '地点/所在/中国',
      depth: 3,
      sort_order: 5,
      self_count: 3,
      subtree_count: 414,
    });
  });

  it('根级路径的末级段就是整条路径(没有 / 时不切出空名)', () => {
    expect(toManagedNode({ ...n, path: '地点', depth: 1 }).name).toBe('地点');
  });
});

describe('菜单落点钳制', () => {
  it('贴右/下边的落点被推回视口内(宽 224+8、高 320+8)', () => {
    expect(clampMenuPos(2000, 2000, 1000, 700)).toEqual({ x: 768, y: 372 });
  });

  it('正常落点原样保留,左上角仍留 8px 边距', () => {
    expect(clampMenuPos(300, 200, 1000, 700)).toEqual({ x: 300, y: 200 });
    expect(clampMenuPos(-5, -5, 1000, 700)).toEqual({ x: 8, y: 8 });
  });
});

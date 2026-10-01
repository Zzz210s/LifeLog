import { describe, expect, it } from 'vitest';
import { applyFilters, axisOf, axisOptions, defaultFilters, MAX_DEPTH_LIMIT } from './graph-filters';
import type { GraphData, GraphNode } from '../../shared/types';

const n = (id: number, path: string, parent: number | null, notes: number, depth = 1): GraphNode => ({
  id, path, depth, parent, notes, selfCount: notes, sortOrder: 0,
});

const data: GraphData = {
  nodes: [
    n(1, '时间', null, 1038),
    n(2, '时间/日期', 1, 1038, 2),
    n(3, '地点', null, 414),
    n(4, '地点/所在', 3, 414, 2),
    n(5, '空标签', null, 0),
  ],
  edges: [
    { a: 1, b: 2, kind: 'tree', weight: 1 },
    { a: 3, b: 4, kind: 'tree', weight: 1 },
    { a: 3, b: 2, kind: 'co', weight: 9 },
  ],
};

const all = { axes: ['时间', '地点', '空标签'], maxDepth: MAX_DEPTH_LIMIT, onlyWithNotes: false, minNotes: 0 };

describe('applyFilters:过滤 + 折叠 + 丢悬空边', () => {
  it('全勾选 + 不限深度:全量', () => {
    const r = applyFilters(data, all);
    expect(r.nodes).toHaveLength(5);
    expect(r.edges).toHaveLength(3);
    expect(r.empty).toBe(false);
  });

  it('取消勾选某轴 = 折叠它:只留根节点,后代消失,连过去的边一并丢(不留悬空边)', () => {
    const r = applyFilters(data, { ...all, axes: ['地点', '空标签'] });
    expect(r.nodes.map((x) => x.path)).toEqual(['时间', '地点', '地点/所在', '空标签']);
    expect(r.edges.map((e) => [e.a, e.b])).toEqual([[3, 4]]);
  });

  it('深度上限:超过上限的后代不出现', () => {
    const r = applyFilters(data, { ...all, maxDepth: 1 });
    expect(r.nodes.map((x) => x.path)).toEqual(['时间', '地点', '空标签']);
  });

  it('只显示有笔记的标签 / 最少笔记数', () => {
    expect(applyFilters(data, { ...all, onlyWithNotes: true }).nodes.map((x) => x.path)).not.toContain('空标签');
    expect(applyFilters(data, { ...all, minNotes: 500 }).nodes.map((x) => x.path)).toEqual(['时间', '时间/日期']);
  });

  it('过滤成空时 empty = true(面板据此给提示与重置)', () => {
    const r = applyFilters(data, { ...all, maxDepth: 1, minNotes: 2000 });
    expect(r.nodes).toHaveLength(0);
    expect(r.empty).toBe(true);
  });
});

describe('axisOf / axisOptions / defaultFilters', () => {
  it('沿 parent 上溯到根', () => {
    expect(axisOf(data, 4)).toBe('地点');
    expect(axisOf(data, 3)).toBe('地点');
  });

  it('成环的点落不了位,返回 null(不进图)', () => {
    const cyclic: GraphData = { nodes: [n(7, 'a', 8, 1), n(8, 'b', 7, 1)], edges: [] };
    expect(axisOf(cyclic, 7)).toBe(null);
  });

  it('轴选项 = 所有根,按 path 排序', () => {
    expect(axisOptions(data)).toEqual(['地点', '时间', '空标签'].sort());
  });

  it('默认展开除折叠根之外的轴', () => {
    const f = defaultFilters(axisOptions(data), ['时间']);
    expect(f.axes).toEqual(['地点', '空标签']);
    expect(f.maxDepth).toBe(MAX_DEPTH_LIMIT);
    expect(f.minNotes).toBe(0);
    expect(f.onlyWithNotes).toBe(false);
  });
});

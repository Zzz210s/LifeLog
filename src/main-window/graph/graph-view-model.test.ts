import { describe, expect, it } from 'vitest';
import { visibleGraph } from './graph-view-model';
import type { GraphData } from '../../shared/types';

const data: GraphData = {
  nodes: [
    { id: 1, path: '时间', depth: 1, parent: null, notes: 1177 },
    { id: 2, path: '时间/日期', depth: 2, parent: 1, notes: 1040 },
    { id: 3, path: '地点', depth: 1, parent: null, notes: 779 },
  ],
  edges: [
    { a: 1, b: 2, kind: 'tree', weight: 1 },
    { a: 1, b: 3, kind: 'co', weight: 12 },
  ],
};

describe('visibleGraph:折叠某个根时只留根节点本身', () => {
  it('折叠 时间:后代节点消失,指向后代的边一并丢弃(不留悬空边)', () => {
    const v = visibleGraph(data, { collapsedRoots: ['时间'] });
    expect(v.nodes.map((n) => n.path)).toEqual(['时间', '地点']);
    expect(v.edges).toEqual([{ a: 1, b: 3, kind: 'co', weight: 12 }]);
  });

  it('不折叠时全量返回', () => {
    const v = visibleGraph(data, { collapsedRoots: [] });
    expect(v.nodes).toHaveLength(3);
    expect(v.edges).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { collapseRootsOf, visibleGraph } from './graph-view-model';
import type { GraphData } from '../../shared/types';

const data: GraphData = {
  nodes: [
    { id: 1, path: '时间', depth: 1, parent: null, notes: 1177, selfCount: 137, sortOrder: 0 },
    { id: 2, path: '时间/日期', depth: 2, parent: 1, notes: 1040, selfCount: 1040, sortOrder: 0 },
    { id: 3, path: '地点', depth: 1, parent: null, notes: 779, selfCount: 779, sortOrder: 0 },
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

// 同字面前缀:折叠「时间」不得误伤另一个根「时间轴」及其子树
const sibling: GraphData = {
  nodes: [
    { id: 1, path: '时间', depth: 1, parent: null, notes: 1177, selfCount: 137, sortOrder: 0 },
    { id: 2, path: '时间/日期', depth: 2, parent: 1, notes: 1040, selfCount: 1040, sortOrder: 0 },
    { id: 3, path: '时间轴', depth: 1, parent: null, notes: 12, selfCount: 0, sortOrder: 0 },
    { id: 4, path: '时间轴/年', depth: 2, parent: 3, notes: 12, selfCount: 12, sortOrder: 0 },
  ],
  edges: [
    { a: 1, b: 2, kind: 'tree', weight: 1 },
    { a: 3, b: 4, kind: 'tree', weight: 1 },
  ],
};

describe('visibleGraph:前缀判定按「路径 + /」逐段比对', () => {
  it('折叠 时间 不误折叠同字面前缀的另一个根 时间轴', () => {
    const v = visibleGraph(sibling, { collapsedRoots: ['时间'] });
    expect(v.nodes.map((n) => n.path)).toEqual(['时间', '时间轴', '时间轴/年']);
    expect(v.edges).toEqual([{ a: 3, b: 4, kind: 'tree', weight: 1 }]);
  });

  it('折叠中间层 进度/1:保留根与自身,数字兄弟 进度/10 不受损', () => {
    const mid: GraphData = {
      nodes: [
        { id: 1, path: '进度', depth: 1, parent: null, notes: 40, selfCount: 0, sortOrder: 0 },
        { id: 2, path: '进度/1', depth: 2, parent: 1, notes: 20, selfCount: 10, sortOrder: 0 },
        { id: 3, path: '进度/10', depth: 2, parent: 1, notes: 20, selfCount: 20, sortOrder: 0 },
        { id: 4, path: '进度/1/完成', depth: 3, parent: 2, notes: 10, selfCount: 10, sortOrder: 0 },
      ],
      edges: [
        { a: 1, b: 2, kind: 'tree', weight: 1 },
        { a: 1, b: 3, kind: 'tree', weight: 1 },
        { a: 2, b: 4, kind: 'tree', weight: 1 },
      ],
    };
    const v = visibleGraph(mid, { collapsedRoots: ['进度/1'] });
    expect(v.nodes.map((n) => n.path)).toEqual(['进度', '进度/1', '进度/10']);
    expect(v.edges).toEqual([
      { a: 1, b: 2, kind: 'tree', weight: 1 },
      { a: 1, b: 3, kind: 'tree', weight: 1 },
    ]);
  });
});

describe('collapseRootsOf:从时间标签模板派生折叠根', () => {
  it('取模板首段', () => {
    expect(collapseRootsOf('时间/日期/{y}/{m}/{d}')).toEqual(['时间']);
  });
  it('单层模板不折叠', () => {
    expect(collapseRootsOf('时间')).toEqual([]);
  });
  it('空/未设置不折叠', () => {
    expect(collapseRootsOf(null)).toEqual([]);
    expect(collapseRootsOf('')).toEqual([]);
  });
  it('后端默认模板取「时间排序」(用户改过根名的库由设置里的新名字生效)', () => {
    expect(collapseRootsOf('时间排序/{y}/{m}/{d}')).toEqual(['时间排序']);
    expect(collapseRootsOf('日期/{y}/{m}/{d}')).toEqual(['日期']);
  });
  it('首段就是占位符时没有可折叠的根名', () => {
    expect(collapseRootsOf('{y}/{m}/{d}')).toEqual([]);
  });
});

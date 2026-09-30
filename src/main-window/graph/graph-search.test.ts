import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { searchNodes } from './graph-search';

const nodes: GraphNode[] = [
  { id: 1, path: '地点/所在/中国', depth: 3, parent: null, notes: 1, selfCount: 1, sortOrder: 0 },
  { id: 2, path: '地点/所在/中国大陆/四川省', depth: 4, parent: null, notes: 1, selfCount: 1, sortOrder: 0 },
  { id: 3, path: '状态/已完成', depth: 2, parent: null, notes: 1, selfCount: 1, sortOrder: 0 },
];

describe('searchNodes:图内搜索', () => {
  it('子序列也能命中(与命令面板同一引擎)', () => {
    expect(searchNodes(nodes, '川省').map((n) => n.id)).toEqual([2]);
  });
  it('空查询返回空', () => {
    expect(searchNodes(nodes, '   ')).toEqual([]);
  });
  it('按分数排序,取前 limit', () => {
    expect(searchNodes(nodes, '中国', 1)).toHaveLength(1);
    expect(searchNodes(nodes, '中国')[0].id).toBe(1);
  });
  it('标签名里的 md 记号不影响匹配', () => {
    const md: GraphNode[] = [
      { id: 9, path: '地点/[郴](chēn)州市', depth: 3, parent: null, notes: 1, selfCount: 1, sortOrder: 0 },
    ];
    expect(searchNodes(md, '郴州市').map((n) => n.id)).toEqual([9]);
  });
});

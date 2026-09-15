import { describe, expect, it } from 'vitest';
import { buildTimeTree, timeRows } from './time-tree';

const rows = [
  { id: 1, path: 'todo', depth: 1, self_count: 1, subtree_count: 1 },
  { id: 10, path: '时间排序', depth: 1, self_count: 0, subtree_count: 6 },
  { id: 11, path: '时间排序/2026', depth: 2, self_count: 0, subtree_count: 6 },
  { id: 12, path: '时间排序/2026/09', depth: 3, self_count: 0, subtree_count: 6 },
  { id: 13, path: '时间排序/2026/09/11', depth: 4, self_count: 2, subtree_count: 2 },
  { id: 14, path: '时间排序/2026/09/13', depth: 4, self_count: 3, subtree_count: 3 },
  { id: 15, path: '时间排序/2026/09/14', depth: 4, self_count: 1, subtree_count: 1 },
  { id: 8, path: '工作', depth: 1, self_count: 1, subtree_count: 1 },
];

describe('timeRows', () => {
  it('只保留时间子树(根与后代),普通标签被排除', () => {
    expect(timeRows(rows as never).map((r) => r.path)).toEqual([
      '时间排序',
      '时间排序/2026',
      '时间排序/2026/09',
      '时间排序/2026/09/11',
      '时间排序/2026/09/13',
      '时间排序/2026/09/14',
    ]);
  });
  it('无时间标签返回空', () => {
    expect(timeRows([{ id: 8, path: '工作', depth: 1, self_count: 1, subtree_count: 1 }] as never)).toEqual([]);
  });
});

describe('buildTimeTree', () => {
  it('扁平 listTags -> 年/月/日层级,单根为时间排序', () => {
    const tree = buildTimeTree(rows as never);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('时间排序');
    expect(tree[0].children.map((n) => n.name)).toEqual(['2026']);
    expect(tree[0].children[0].children.map((n) => n.name)).toEqual(['09']);
    expect(tree[0].children[0].children[0].children.map((n) => n.name)).toEqual(['11', '13', '14']);
  });
  it('计数取子树计数,层级路径与 ID 保留', () => {
    const tree = buildTimeTree(rows as never);
    expect(tree[0].subtreeCount).toBe(6);
    const month = tree[0].children[0].children[0];
    expect(month.path).toBe('时间排序/2026/09');
    expect(month.subtreeCount).toBe(6);
    const days = month.children;
    expect(days.map((n) => [n.path, n.selfCount, n.subtreeCount, n.id])).toEqual([
      ['时间排序/2026/09/11', 2, 2, 13],
      ['时间排序/2026/09/13', 3, 3, 14],
      ['时间排序/2026/09/14', 1, 1, 15],
    ]);
  });
  it('无时间标签返回空数组(分区整段隐藏)', () => {
    expect(buildTimeTree([{ id: 8, path: '工作', depth: 1, self_count: 1, subtree_count: 1 }] as never)).toEqual([]);
  });
  it('父行缺失时按路径补出结构节点(兜底数据不一致)', () => {
    const tree = buildTimeTree([
      { id: 15, path: '时间排序/2026/09/14', depth: 4, self_count: 1, subtree_count: 1 },
    ] as never);
    expect(tree[0].selfCount).toBe(0);
    expect(tree[0].children[0].children[0].children[0].path).toBe('时间排序/2026/09/14');
    expect(tree[0].subtreeCount).toBe(1); // 结构层自底向上求和
  });
});

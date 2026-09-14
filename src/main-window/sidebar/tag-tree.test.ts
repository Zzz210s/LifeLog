import { describe, expect, it } from 'vitest';
import { buildTree, filterTree, isSelectable, rewriteTagPaths, toggleTagPick } from './tag-tree';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';

const rows = [
  { path: '工作', depth: 1, self_count: 0, subtree_count: 3 },
  { path: '工作/项目A', depth: 2, self_count: 1, subtree_count: 2 },
  { path: '工作/项目A/会议', depth: 3, self_count: 2, subtree_count: 2 },
  { path: '生活', depth: 1, self_count: 1, subtree_count: 1 },
];

describe('buildTree', () => {
  it('按路径嵌套并保留计数', () => {
    const tree = buildTree(rows as never);
    expect(tree.map((n) => n.name)).toEqual(['工作', '生活']);
    expect(tree[0].children[0].name).toBe('项目A');
    expect(tree[0].children[0].children[0].name).toBe('会议');
    expect(tree[0].subtreeCount).toBe(3);
  });
  it('父节点缺失时按路径补出结构节点(计数 0)', () => {
    const tree = buildTree([{ path: 'a/b', depth: 2, self_count: 1, subtree_count: 1 }] as never);
    expect(tree[0].name).toBe('a');
    expect(tree[0].selfCount).toBe(0);
    expect(tree[0].children[0].name).toBe('b');
  });
  it('结构节点不可右键管理(id 为 null),真实标签携带 id', () => {
    const tree = buildTree([
      { id: 7, path: 'a/b', depth: 2, self_count: 1, subtree_count: 1 },
    ] as never);
    expect(tree[0].id).toBe(null); // 补出的父级
    expect(tree[0].children[0].id).toBe(7);
  });
  it('结构节点的含子级计数由子树求和补齐', () => {
    const tree = buildTree([{ path: 'a/b', depth: 2, self_count: 2, subtree_count: 2 }] as never);
    expect(tree[0].subtreeCount).toBe(2);
  });
});

describe('isSelectable', () => {
  it('本级为 0 但仍有子级的结构节点不可选', () => {
    const tree = buildTree(rows as never);
    expect(isSelectable(tree[0])).toBe(false);
    expect(isSelectable(tree[0].children[0])).toBe(true);
  });
  it('无子节点但本级有链接的叶子可选', () => {
    const tree = buildTree(rows as never);
    expect(isSelectable(tree[1])).toBe(true); // 生活:self 1、无子级
  });
  it('无子节点且本级为 0 的叶子也可选(语义固化:结构节点=本级 0 且有子级)', () => {
    const tree = buildTree([{ path: '空', depth: 1, self_count: 0, subtree_count: 0 }] as never);
    expect(isSelectable(tree[0])).toBe(true);
  });
});

describe('filterTree', () => {
  it('命中子节点时保留祖先链', () => {
    const filtered = filterTree(buildTree(rows as never), '会议');
    expect(filtered[0].name).toBe('工作');
    expect(filtered[0].children[0].children[0].name).toBe('会议');
  });
  it('无命中返回空', () => {
    expect(filterTree(buildTree(rows as never), 'zzz')).toEqual([]);
  });
  it('空查询原样返回', () => {
    const tree = buildTree(rows as never);
    expect(filterTree(tree, '  ')).toBe(tree);
  });
  it('按完整路径子串命中(输入父级路径片段可见整棵子树)', () => {
    const filtered = filterTree(buildTree(rows as never), '工作/项目');
    expect(filtered[0].children[0].name).toBe('项目A');
    expect(filtered[0].children[0].children).toHaveLength(1);
  });
});

describe('toggleTagPick(侧栏行点击的两侧判定)', () => {
  const base: FilterConditions = {
    ...EMPTY_FILTER,
    tags: [{ path: '工作', includeChildren: true }],
    excludeTags: [{ path: '生活', includeChildren: false }],
  };
  it('路径在排除侧:点击撤掉该排除项(不进 tags)', () => {
    const next = toggleTagPick(base, '生活');
    expect(next.excludeTags).toHaveLength(0);
    expect(next.tags).toBeUndefined(); // 不动引入侧,避免同路径两侧并存(结果恒空)
  });
  it('路径在引入侧:点击移除引入项(不动排除侧)', () => {
    const next = toggleTagPick(base, '工作');
    expect(next.tags).toHaveLength(0);
    expect(next.excludeTags).toBeUndefined();
  });
  it('两侧都不在:点击经 applyTagPick 加入引入侧(含子级,不清既有项)', () => {
    const next = toggleTagPick(base, 'todo');
    expect(next.tags).toEqual([
      { path: '工作', includeChildren: true },
      { path: 'todo', includeChildren: true },
    ]);
    expect(next.excludeTags).toBeUndefined();
  });
});

describe('rewriteTagPaths', () => {
  const base: FilterConditions = {
    ...EMPTY_FILTER,
    tags: [{ path: '工作/项目A', includeChildren: true }],
    excludeTags: [{ path: '工作', includeChildren: false }],
  };
  it('改名:条件里的标签路径按前缀级联改写(含排除侧)', () => {
    const next = rewriteTagPaths(base, '工作', 'WORK');
    expect(next.tags[0].path).toBe('WORK/项目A');
    expect(next.excludeTags[0].path).toBe('WORK');
  });
  it('移动:旧路径整段前缀替换为新路径', () => {
    const next = rewriteTagPaths(base, '工作/项目A', '生活/项目A');
    expect(next.tags[0].path).toBe('生活/项目A');
    expect(next.excludeTags[0].path).toBe('工作'); // 不受影响
  });
  it('无命中返回原对象(不触发重查)', () => {
    expect(rewriteTagPaths(base, '别的', 'x')).toBe(base);
  });
});

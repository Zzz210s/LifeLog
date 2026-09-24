import { describe, expect, it } from 'vitest';
import { buildTree, isManageable, isSelectable, rewriteTagPaths, toggleTagPick } from './tag-tree';
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

describe('buildTree 同层次序(S8)', () => {
  it('兄弟按 (sort_order, path) 排,而非扁平返回的路径序', () => {
    const tree = buildTree([
      { id: 1, path: 'a', depth: 1, sort_order: 2, self_count: 1, subtree_count: 1 },
      { id: 2, path: 'b', depth: 1, sort_order: 0, self_count: 1, subtree_count: 1 },
      { id: 3, path: 'c', depth: 1, sort_order: 1, self_count: 1, subtree_count: 1 },
    ] as never);
    expect(tree.map((n) => n.path)).toEqual(['b', 'c', 'a']);
    expect(tree.map((n) => n.sortOrder)).toEqual([0, 1, 2]);
  });
  it('sort_order 相同时按 path(码元序,与 SQLite BINARY 一致)', () => {
    const tree = buildTree([
      { id: 1, path: 'b', depth: 1, sort_order: 0, self_count: 1, subtree_count: 1 },
      { id: 2, path: 'a', depth: 1, sort_order: 0, self_count: 1, subtree_count: 1 },
    ] as never);
    expect(tree.map((n) => n.path)).toEqual(['a', 'b']);
  });
  it('只排同一层的兄弟,不跨层比较', () => {
    const tree = buildTree([
      { id: 1, path: 'p', depth: 1, sort_order: 0, self_count: 0, subtree_count: 2 },
      { id: 2, path: 'p/x', depth: 2, sort_order: 5, self_count: 1, subtree_count: 1 },
      { id: 3, path: 'p/y', depth: 2, sort_order: 1, self_count: 1, subtree_count: 1 },
    ] as never);
    expect(tree[0].children.map((n) => n.path)).toEqual(['p/y', 'p/x']);
  });
});

describe('isSelectable(子蕴含父:2026-09-20 D9 的有意行为变更)', () => {
  it('本级为 0 但链接都在子级的父标签可选(点击 = 加入筛选,默认含子级)', () => {
    const tree = buildTree(rows as never);
    expect(isSelectable(tree[0])).toBe(true); // 工作:self 0、subtree 3
    expect(isSelectable(tree[0].children[0])).toBe(true); // 项目A:self 1、subtree 2
  });
  it('无子节点但本级有链接的叶子可选', () => {
    const tree = buildTree(rows as never);
    expect(isSelectable(tree[1])).toBe(true); // 生活:self 1、无子级
  });
  it('含子级计数为 0 的空容器不可选(没有可筛内容,只能展开/右键管理)', () => {
    const tree = buildTree([{ path: '空', depth: 1, self_count: 0, subtree_count: 0 }] as never);
    expect(isSelectable(tree[0])).toBe(false);
  });
  it('父行缺失补出的结构节点:含子级计数由子树求和,有链接即同样可选', () => {
    const tree = buildTree([{ path: 'a/b', depth: 2, self_count: 1, subtree_count: 1 }] as never);
    expect(isSelectable(tree[0])).toBe(true);
  });
});

describe('isManageable(右键管理入口把关)', () => {
  it('真实标签行可管理', () => {
    const tree = buildTree([{ id: 7, path: '工作', depth: 1, self_count: 1, subtree_count: 1 }] as never);
    expect(isManageable(tree[0])).toBe(true);
  });
  it('补出的结构节点(id null)不可管理', () => {
    const tree = buildTree([{ id: 7, path: 'a/b', depth: 2, self_count: 1, subtree_count: 1 }] as never);
    expect(isManageable(tree[0])).toBe(false);
  });
  it('时间标签已是普通标签(D3):有真实 DB id 同样可管理', () => {
    const tree = buildTree([
      { id: 2, path: '时间排序/2026/09/13', depth: 4, self_count: 3, subtree_count: 3 },
    ] as never);
    const day = tree[0].children[0].children[0].children[0];
    expect(day.path).toBe('时间排序/2026/09/13');
    expect(day.id).toBe(2);
    expect(isManageable(day)).toBe(true);
    expect(isManageable(tree[0])).toBe(false); // 补出的时间根(没有真实行)
  });
});

describe('toggleTagPick(侧栏行点击的两侧判定)', () => {
  const base: FilterConditions = {
    ...EMPTY_FILTER,
    tags: [{ path: '工作', includeChildren: true }],
    excludeTags: [{ path: '生活', includeChildren: false }],
  };
  it('路径在排除侧:采纳 = 移到包含侧(与统一输入框 `#` 同口径,2026-09-24 计划 2/3 定死)', () => {
    const next = toggleTagPick(base, '生活');
    expect(next.tags).toEqual([
      { path: '工作', includeChildren: true },
      { path: '生活', includeChildren: true },
    ]);
    expect(next.excludeTags).toHaveLength(0); // 同一路径不再留在排除侧(两侧并存的结果恒空)
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

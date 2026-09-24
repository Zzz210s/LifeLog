import { describe, expect, it } from 'vitest';
import type { FilterConditions } from '../../shared/filter-conditions';
import { effectFor } from './unified-accept';

// 条件向量按真类型标注:brief 原文的 `as never` 在 `{ ...cond }` 展开处会报 TS2698(never 不可展开)
const cond = { keyword: null, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null } as FilterConditions;

describe('采纳副作用(设计 §4 表)', () => {
  it('@ 打开笔记 -> 滚到该条', () => {
    expect(effectFor('open', { id: '12', label: '夏天', ranges: [] } as never, cond))
      .toEqual({ kind: 'scroll-to-note', id: 12 });
  });
  it('# 选标签 -> 加进筛选条件(含子级)', () => {
    expect(effectFor('tag', { id: '工作/项目A', label: '工作/项目A', ranges: [] } as never, cond))
      .toEqual({ kind: 'filter-patch', patch: { tags: [{ path: '工作/项目A', includeChildren: true }], excludeTags: [] } });
  });
  it('> 选命令 -> 跑该命令', () => {
    expect(effectFor('command', { id: 'export.all', label: '导出整库', ranges: [] } as never, cond))
      .toEqual({ kind: 'run-command', id: 'export.all' });
  });
  it('已有同名标签条件时不重复加', () => {
    const has = { ...cond, tags: [{ path: '工作/项目A', includeChildren: true }] } as never;
    expect(effectFor('tag', { id: '工作/项目A', label: '工作/项目A', ranges: [] } as never, has))
      .toEqual({ kind: 'none' });
  });
  it('只在排除侧存在的标签 -> 采纳后移到包含侧(补丁同时带两侧,排除项被移除)', () => {
    const only = { ...cond, excludeTags: [{ path: '工作/项目A', includeChildren: true }] } as never;
    expect(effectFor('tag', { id: '工作/项目A', label: '工作/项目A', ranges: [] } as never, only))
      .toEqual({
        kind: 'filter-patch',
        patch: { tags: [{ path: '工作/项目A', includeChildren: true }], excludeTags: [] },
      });
  });
  it('记录模式与筛选模式没有采纳副作用', () => {
    expect(effectFor('note', { id: 'x', label: 'x', ranges: [] } as never, cond)).toEqual({ kind: 'none' });
  });
});

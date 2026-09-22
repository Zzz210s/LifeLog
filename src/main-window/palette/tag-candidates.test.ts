/**
 * 标签候选池的单测(T6 复审 I1):同一数据版本内只打一次 list_tags、版本变化即作废、
 * 并发共享同一次取回、失败不缓存(一次 IPC 抖动不能把整个版本卡死)。
 */
import { describe, expect, it, vi } from 'vitest';
import type { TagCount } from '../../shared/types';
import { createTagCandidates } from './tag-candidates';

const tag = (path: string, subtree = 0): TagCount => ({
  id: path.length,
  path,
  depth: 0,
  sort_order: 0,
  self_count: subtree,
  subtree_count: subtree,
});

describe('tag-candidates:按数据版本缓存', () => {
  it('同一版本内重复取候选只打一次库', async () => {
    const fetchTags = vi.fn(async () => [tag('工作', 4)]);
    const pool = createTagCandidates(fetchTags);
    await pool.current(0);
    await pool.current(0);
    await pool.current(0);
    expect(fetchTags).toHaveBeenCalledTimes(1);
  });

  it('版本变化即作废:下一次取候选重打库,之后同版本复用', async () => {
    const fetchTags = vi.fn(async () => [tag('工作', 4)]);
    const pool = createTagCandidates(fetchTags);
    await pool.current(0);
    await pool.current(1);
    expect(fetchTags).toHaveBeenCalledTimes(2);
    await pool.current(1);
    expect(fetchTags).toHaveBeenCalledTimes(2);
  });

  it('并发调用共享同一次取回(同一版本)', async () => {
    const fetchTags = vi.fn(async () => [tag('工作', 4)]);
    const pool = createTagCandidates(fetchTags);
    const [a, b] = await Promise.all([pool.current(0), pool.current(0)]);
    expect(a).toBe(b);
    expect(fetchTags).toHaveBeenCalledTimes(1);
  });

  it('取回失败原样抛,且不缓存:同版本下一次调用重新取', async () => {
    const fetchTags = vi
      .fn<() => Promise<readonly TagCount[]>>()
      .mockRejectedValueOnce(new Error('标签查询失败'))
      .mockResolvedValueOnce([tag('工作', 4)]);
    const pool = createTagCandidates(fetchTags);
    await expect(pool.current(0)).rejects.toThrow(/标签查询失败/);
    await expect(pool.current(0)).resolves.toEqual([tag('工作', 4)]);
    expect(fetchTags).toHaveBeenCalledTimes(2);
  });
});

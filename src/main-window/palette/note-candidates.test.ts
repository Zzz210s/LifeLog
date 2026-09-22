/** 笔记候选池的单测:分页取回、末页短路、200 硬上限、缓存共享、refresh 重取、失败不吞 */
import { describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import {
  NOTES_PAGE,
  createNoteCandidates,
  recentConditions,
  searchConditions,
} from './note-candidates';

const note = (id: number): Note => ({ id, content: `n${id}`, created_at: '2026-09-22 10:00:00', tags: [] });
const pageOf = (from: number, count: number): Note[] =>
  Array.from({ length: count }, (_, i) => note(from + i));

describe('note-candidates:分页与上限', () => {
  it('满页时取满 4 页(200 条)', async () => {
    const fetchPage = vi.fn(async (offset: number) => pageOf(offset, NOTES_PAGE));
    const rows = await createNoteCandidates(fetchPage).current();
    expect(rows).toHaveLength(200);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 50, 100, 150]);
  });

  it('末页不满即短路(不再打库)', async () => {
    const fetchPage = vi.fn(async (offset: number) => pageOf(offset, offset === 0 ? NOTES_PAGE : 7));
    const rows = await createNoteCandidates(fetchPage).current();
    expect(rows).toHaveLength(NOTES_PAGE + 7);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('缓存共享:并发与后续调用只取一次;refresh 后重取', async () => {
    const fetchPage = vi.fn(async () => pageOf(1, 3));
    const pool = createNoteCandidates(fetchPage);
    const [a, b] = await Promise.all([pool.current(), pool.current()]);
    expect(a).toBe(b);
    await pool.current();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    pool.refresh();
    await pool.current();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('取回失败原样抛(不静默成空候选)', async () => {
    const pool = createNoteCandidates(async () => {
      throw new Error('查询失败');
    });
    await expect(pool.current()).rejects.toThrow(/查询失败/);
  });
});

describe('note-candidates:查询条件', () => {
  it('候选条件不继承主窗筛选(全部笔记,最新在前);FTS 条件带关键词', () => {
    expect(recentConditions()).toEqual({
      keyword: null,
      tags: [],
      excludeTags: [],
      tagPresence: null,
      sort: 'newest',
      expr: null,
    });
    expect(searchConditions('牛奶').keyword).toBe('牛奶');
  });
});

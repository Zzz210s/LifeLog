import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
import type { Note } from '../shared/types';
import type { ErrorKind } from './ErrorBar';
import { PAGE, mergeNotes } from './notes-list';

/** 流查询筛选:关键词 + 标签 AND + 排序方向 */
export interface NotesFeedFilters {
  keyword: string;
  tags: string[];
  oldestFirst: boolean;
}

/**
 * 主窗流查询状态机(自 App 抽出以守 200 行上限):分页、过期响应丢弃、查询错误与失败事实。
 * fetchPage 身份随筛选变化,随后整表重查;App 侧另 watch 筛选以退出编辑态。
 */
export function useNotesFeed(
  { keyword, tags, oldestFirst }: NotesFeedFilters,
  setError: (kind: ErrorKind, message: string) => void,
  clearError: (kind: ErrorKind) => void
) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queryFailed, setQueryFailed] = useState(false); // 查询失败事实留存,供空态文案判定
  const seq = useRef(0); // 过期响应丢弃(快速切筛选/翻页竞态)

  /** 拉一页:append=true 追加(offset=当前长度),否则整表重置 */
  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const id = ++seq.current;
      setLoading(true);
      try {
        const page = await api.queryNotes({ keyword, tags, offset, limit: PAGE, oldestFirst });
        if (id !== seq.current) return;
        setNotes((prev) => (append ? mergeNotes(prev, page) : page));
        setHasMore(page.length === PAGE);
        setQueryFailed(false);
        clearError('query');
      } catch (e) {
        if (id !== seq.current) return;
        // 失败必须与"暂无记录"区分:错误行可见,且停掉分页避免哨兵反复重触发失败请求
        setError('query', '加载笔记失败: ' + String(e));
        setQueryFailed(true);
        setHasMore(false);
        if (!append) setNotes([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [keyword, tags, oldestFirst, setError, clearError]
  );

  // 筛选变化:整表重查(fetchPage 身份随之变化)
  useEffect(() => {
    void fetchPage(0, false);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    void fetchPage(notes.length, true);
  }, [fetchPage, notes]);

  /** 查询失败的恢复入口:重发首页(瞬时故障无需改筛选) */
  const retry = useCallback(() => {
    void fetchPage(0, false);
  }, [fetchPage]);

  return { notes, setNotes, hasMore, loading, queryFailed, fetchPage, loadMore, retry };
}

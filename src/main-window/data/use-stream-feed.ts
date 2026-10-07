/**
 * 信息流数据合流口(计划 T5):平铺 `useNotesFeed` 与分组 `useGroupedNotes` 在这里合成一个形状,
 * 让 App / StreamView 只消费一种 feed。平铺路径一行不改 —— 无 groupBy 时原样透传。
 * 分组模式:notes = 已加载的组内笔记(供编辑态存在性判定与引用计数),
 * fetchPage/setNotes 改走分组 hook(编辑保存后整组重查或就地写回各组)。
 */
import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Note } from '../../shared/types';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { ErrorKind } from '../shell/ErrorBar';
import { useNotesFeed } from './use-notes-feed';
import { useGroupedNotes } from './use-grouped-notes';
import type { NoteGroup } from './use-grouped-notes';

/** 分组渲染接线(StreamView 只认这一包,不直接知道分组 hook 的内部状态) */
export interface GroupedView {
  groups: NoteGroup[];
  collapsed: ReadonlySet<string>;
  loadingGroup: string | null;
  onToggle: (sessionKey: string) => void;
  onLoadMore: (sessionKey: string) => void;
}

export interface StreamFeed {
  notes: Note[];
  setNotes: Dispatch<SetStateAction<Note[]>>;
  hasMore: boolean;
  loading: boolean;
  queryFailed: boolean;
  fetchPage: (offset: number, append: boolean) => Promise<void>;
  loadMore: () => void;
  retry: () => void;
  /** 非空 = 分组模式(渲染分组);degraded 时恒 null(退化为平铺) */
  grouping: GroupedView | null;
  /** 提示文案:degraded -> 已按平铺显示;slow -> 仍分组,建议加筛选 */
  notice: string | null;
}

const noop = (): void => {};

export function useStreamFeed(
  conditions: FilterConditions,
  setError: (kind: ErrorKind, message: string) => void,
  clearError: (kind: ErrorKind) => void
): StreamFeed {
  const flat = useNotesFeed(conditions, setError, clearError);
  const grouped = useGroupedNotes(conditions, setError, clearError);

  const grouping = useMemo<GroupedView | null>(() => {
    if (!grouped.enabled || grouped.degraded) return null;
    return {
      groups: grouped.groups,
      collapsed: grouped.collapsed,
      loadingGroup: grouped.loadingGroup,
      onToggle: grouped.toggleCollapsed,
      onLoadMore: grouped.loadMoreGroup,
    };
  }, [
    grouped.enabled,
    grouped.degraded,
    grouped.groups,
    grouped.collapsed,
    grouped.loadingGroup,
    grouped.toggleCollapsed,
    grouped.loadMoreGroup,
  ]);

  if (!grouped.enabled) return { ...flat, grouping: null, notice: null };
  if (grouped.degraded) {
    return { ...flat, grouping: null, notice: '分组结果过多，已按平铺显示' };
  }
  return {
    notes: grouped.allNotes,
    setNotes: grouped.setNotes,
    hasMore: false,
    loading: grouped.loading,
    queryFailed: grouped.queryFailed,
    fetchPage: grouped.reload,
    loadMore: noop,
    retry: grouped.reload,
    grouping,
    notice: grouped.slow ? '结果很多，建议加筛选' : null,
  };
}

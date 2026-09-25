/**
 * 编辑态与笔记就地操作(自 App.tsx 抽出以守行数红线):把 useNoteActions 与"进编辑/切编辑/
 * 标签变更后重载"的决策收在一处。App 只负责把依赖递进来。
 */
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Note } from '../../shared/types';
import type { FilterConditions } from '../../shared/filter-conditions';
import { useNoteActions } from '../data/use-note-actions';
import type { ErrorKind } from './ErrorBar';

export interface EditFlowOptions {
  conditions: FilterConditions;
  fetchPage: (offset: number, append: boolean) => Promise<void>;
  setNotes: Dispatch<SetStateAction<Note[]>>;
  setEditingId: Dispatch<SetStateAction<number | null>>;
  reloadTags: () => void;
  reloadFilter: () => void;
  setError: (kind: ErrorKind, message: string) => void;
  clearError: (kind: ErrorKind) => void;
}

export interface EditFlow {
  remove: (note: Note) => void;
  onEditSaved: (note: Note) => void;
  toggleTask: (note: Note, index: number) => void;
  /** 点正文进编辑:面板在场时由面板的提交守卫接管(点另一条 = 先存后进) */
  requestEdit: (note: Note) => void;
  /** 编辑面板已提交成功后的切换(内容未变也走这条):不受"编辑中不抢"守卫限制 */
  switchEdit: (note: Note) => void;
  /** 标签改名/移动/删除成功:刷新标签树;路径变化时重读当前筛选(Rust 已改写条件) */
  handleTagsMutated: (pathChange?: { from: string; to: string }) => void;
}

export function useEditFlow(o: EditFlowOptions): EditFlow {
  const { remove, onEditSaved, toggleTask } = useNoteActions({
    conditions: o.conditions,
    fetchPage: o.fetchPage,
    setNotes: o.setNotes,
    setEditingId: (id) => o.setEditingId(id),
    reload: o.reloadTags,
    setError: o.setError,
    clearError: o.clearError,
  });

  // 用函数式更新读最新值,避免同一 tick 里已被排队清空的旧 editingId
  const requestEdit = useCallback(
    (note: Note) => {
      o.setEditingId((prev) => (prev === null ? note.id : prev));
    },
    [o.setEditingId],
  );
  const switchEdit = useCallback((note: Note) => o.setEditingId(() => note.id), [o.setEditingId]);

  const handleTagsMutated = useCallback(
    (pathChange?: { from: string; to: string }) => {
      o.reloadTags();
      if (pathChange) o.reloadFilter();
    },
    [o.reloadTags, o.reloadFilter],
  );

  return { remove, onEditSaved, toggleTask, requestEdit, switchEdit, handleTagsMutated };
}

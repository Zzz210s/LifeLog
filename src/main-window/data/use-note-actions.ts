/**
 * 笔记就地变更动作(自 App 抽出以守 200 行上限):编辑保存、删除。
 * 决策 G5 一并在此:含关键词或本地判不了的条件(含子级/排除/有无标签/表达式)时重查首页,
 * 否则就地替换并本地移除不再满足标签筛选的条目(保住分页与滚动位置,S3)。
 */
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { api } from '../../shared/api';
import { toggleTaskAt } from '../../shared/md-task';
import { composeSource } from '../../shared/note-source';
import type { Note } from '../../shared/types';
import { canEvaluateLocally, matchesTagsByPath } from '../../shared/filter-conditions-local';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { ErrorKind } from '../shell/ErrorBar';
import { needsRefetchAfterChange, replaceNote } from '../stream/notes-list';

export interface NoteActionsDeps {
  conditions: FilterConditions;
  fetchPage: (offset: number, append: boolean) => Promise<void>;
  setNotes: Dispatch<SetStateAction<Note[]>>;
  setEditingId: (id: number | null) => void;
  /** 标签/数据刷新入口(成功路径调用) */
  reload: () => void;
  setError: (kind: ErrorKind, message: string) => void;
  clearError: (kind: ErrorKind) => void;
}

export function useNoteActions(d: NoteActionsDeps) {
  const { conditions, fetchPage, setNotes, setEditingId, reload, setError, clearError } = d;
  /**
   * 变更后落库视图:有关键词筛选时重查首页 —— keyword 同时匹配正文与标签两列,
   * 本地判不了命中,正确性优先于滚动位置;无条件收窄时就地更新。
   */
  const applyNoteChange = useCallback(
    (updated: Note) => {
      if (!canEvaluateLocally(conditions) || needsRefetchAfterChange(conditions.keyword ?? '')) {
        void fetchPage(0, false);
        return;
      }
      setNotes((prev) => {
        const next = replaceNote(prev, updated);
        return matchesTagsByPath(updated, conditions)
          ? next
          : next.filter((n) => n.id !== updated.id);
      });
    },
    [conditions, fetchPage, setNotes]
  );

  /**
   * 删除前必须问一次:不能用 window.confirm —— tauri-plugin-dialog 的初始化脚本把它覆写成
   * async(invoke) 的 Promise,`!Promise` 恒为 false,确认形同虚设直接删库(2026-09-12 实测)。
   * 插件导出的 confirm 走 plugin:dialog|message,在 dialog:default 权限内。
   */
  const remove = useCallback(
    (note: Note) => {
      void (async () => {
        const ok = await confirm('删除这条笔记?', {
          title: '删除笔记',
          kind: 'warning',
        }).catch(() => false); // 弹窗失败一律当作取消,绝不静默删除
        if (!ok) return;
        try {
          await api.deleteNote(note.id);
          setNotes((prev) => prev.filter((n) => n.id !== note.id));
          setEditingId(null);
          clearError('action');
          reload();
        } catch (e) {
          setError('action', '删除失败: ' + String(e));
        }
      })();
    },
    [setNotes, setEditingId, reload, setError, clearError]
  );

  /** 编辑保存:用命令返回的就地更新,不重置分页(用户滚到深处编辑不会被弹回顶部) */
  const onEditSaved = useCallback(
    (note: Note) => {
      applyNoteChange(note);
      setEditingId(null);
      clearError('action');
      reload();
    },
    [applyNoteChange, setEditingId, reload, clearError]
  );

  /**
   * 勾选/取消读视图里第 index 个任务列表项:改写正文后用 composeSource 连同全部标签写回。
   * update_note 是标签整集合替换语义,只发新正文会把标签清空,故必须带回该笔记的全部标签。
   * 成功后就地刷新该条(有关键词筛选时 applyNoteChange 会重查首页);失败进既有错误条。
   */
  const toggleTask = useCallback(
    (note: Note, index: number) => {
      const next = toggleTaskAt(note.content, index);
      if (next === null) return; // 索引与当前正文对不上(如并发编辑):静默 no-op
      void (async () => {
        try {
          const updated = await api.updateNote(note.id, composeSource(next, note.tags));
          if (updated) applyNoteChange(updated);
          else setNotes((prev) => prev.filter((n) => n.id !== note.id)); // 已被并发删除:本行消失
          clearError('action');
          reload();
        } catch (e) {
          setError('action', '勾选失败: ' + String(e));
        }
      })();
    },
    [applyNoteChange, setNotes, reload, setError, clearError]
  );

  return { remove, onEditSaved, toggleTask };
}

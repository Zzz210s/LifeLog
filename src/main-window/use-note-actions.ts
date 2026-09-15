/**
 * 笔记就地变更动作(自 App 抽出以守 200 行上限):编辑保存、勾选待办、删除。
 * 决策 G5 一并在此:含关键词或本地判不了的条件(含子级/排除/日期/有无标签)时重查首页,
 * 否则就地替换并本地移除不再满足标签筛选的条目(保住分页与滚动位置,S3)。
 */
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { api } from '../shared/api';
import type { Note } from '../shared/types';
import { canEvaluateLocally, matchesTagsByPath } from '../shared/filter-conditions-local';
import type { FilterConditions } from '../shared/filter-conditions';
import type { ErrorKind } from './ErrorBar';
import { needsRefetchAfterChange, replaceNote } from './notes-list';

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
  const [dateFlash, setDateFlash] = useState(false); // 改期成功提示(2 秒后消失,同导出提示)

  useEffect(() => {
    if (!dateFlash) return;
    const id = window.setTimeout(() => setDateFlash(false), 2000);
    return () => window.clearTimeout(id);
  }, [dateFlash]);
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

  const toggleTodo = useCallback(
    (note: Note) => {
      void api
        .toggleTodo(note.id)
        .then((updated) => {
          if (updated) applyNoteChange(updated);
          clearError('action');
          reload();
        })
        .catch((e) => setError('action', '切换待办状态失败: ' + String(e)));
    },
    [applyNoteChange, reload, setError, clearError]
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
   * 改期:时间标签变化会同时影响排序(4.3 按时间标签路径)与筛选(日期范围/时间标签条件),
   * 本地判不了命中与次序,故成功后重查首页并刷新标签徽标(reload),不做就地替换。
   * 失败只报错,不动本地状态(列表保持后端事实)。
   */
  const setDate = useCallback(
    (note: Note, date: string) => {
      void api
        .setNoteDate(note.id, date)
        .then(() => {
          clearError('action');
          reload();
          void fetchPage(0, false);
          setDateFlash(true);
        })
        .catch((e) => setError('action', '修改日期失败: ' + String(e)));
    },
    [clearError, fetchPage, reload, setError]
  );

  return { remove, toggleTodo, onEditSaved, setDate, dateFlash };
}

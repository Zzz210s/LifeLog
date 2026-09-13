import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { api } from '../shared/api';
import type { Note } from '../shared/types';
import { Composer } from './Composer';
import { ErrorBars } from './ErrorBars';
import type { ErrorKind } from './ErrorBar';
import { dropError, putError } from './errors';
import type { ErrorMap } from './errors';
import type { MainView } from './settings/settings-model';
import { FilterBar } from './FilterBar';
import { canEvaluateLocally, matchesTagsByPath } from '../shared/filter-conditions';
import { needsRefetchAfterChange, replaceNote } from './notes-list';
import { NoteStream } from './NoteStream';
import { SettingsView } from './SettingsView';
import { TopBar } from './TopBar';
import { useNoteCreatedRefresh } from './use-note-created';
import { useOpenSettings } from './use-open-settings';
import { useNotesFeed } from './use-notes-feed';
import { useFilterConditions } from './use-filter-conditions';
import { useNotesExport } from './use-export';

/** 主窗 v2:单列流 = Composer + FilterBar + NoteStream(无左侧导航) */
export function App(): ReactNode {
  // 筛选条件真源(含 filter_last 持久化):标签、排序、分页查询都从它派生
  const { conditions, patch, toggleTag } = useFilterConditions();
  const [allTags, setAllTags] = useState<{ name: string; count: number }[]>([]);
  const [errors, setErrors] = useState<ErrorMap>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [view, setView] = useState<MainView>('stream');

  /** 按来源留存/清除:G4 单值槽会被跨源覆盖造成错误被吞,改为每个来源一份,成功路径只清同源 */
  const setError = useCallback((kind: ErrorKind, message: string) => {
    setErrors((prev) => putError(prev, kind, message));
  }, []);
  const clearError = useCallback((kind: ErrorKind) => {
    setErrors((prev) => dropError(prev, kind));
  }, []);
  const { exporting, exported, onExport } = useNotesExport(setError, clearError);
  const { notes, setNotes, hasMore, loading, queryFailed, fetchPage, loadMore, retry } =
    useNotesFeed(conditions, setError, clearError);

  const loadTags = useCallback(() => {
    void api
      .tagCounts()
      .then((rows) => {
        setAllTags(rows.map(([name, count]) => ({ name, count })));
        clearError('tags');
      })
      .catch((e) => setError('tags', '标签加载失败: ' + String(e)));
  }, [clearError]);

  // 筛选变化:退出编辑态(列表重查由 useNotesFeed 负责)
  useEffect(() => {
    setEditingId(null);
  }, [conditions]);

  useEffect(loadTags, [loadTags]);

  /** 新增笔记后回第一页(新内容必在最前);就地变更走 replaceNote,不重置分页与滚动位置 */
  const refresh = useCallback(() => {
    setEditingId(null);
    void fetchPage(0, false);
    loadTags();
  }, [fetchPage, loadTags]);

  // 输入栏保存后主窗自动出现(W1);已翻页或正在编辑时由 shouldAutoRefresh 拦下
  useNoteCreatedRefresh(notes.length, editingId, refresh, (m) =>
    setError('action', m)
  );

  // 托盘「设置」菜单:窗口已由 Rust 显示,这里只切视图
  const openSettings = useCallback(() => setView('settings'), []);
  const reportSettingsError = useCallback((m: string) => setError('action', m), [setError]);
  useOpenSettings(openSettings, reportSettingsError);

  /**
   * 变更后落库视图(G5 权衡):
   * 有关键词筛选时重查首页 —— keyword 同时匹配正文与标签两列,本地判不了命中,正确性优先于滚动位置;
   * 无关键词时就地更新,并本地移除不再满足标签筛选的条目(保住分页与滚动位置,S3)。
   */
  const applyNoteChange = useCallback(
    (updated: Note) => {
      // 含子级/排除/日期/有无标签这类条件本地判不了,统一重查首页,正确性优先于滚动位置
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
    [conditions, fetchPage]
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
          loadTags();
        } catch (e) {
          setError('action', '删除失败: ' + String(e));
        }
      })();
    },
    [loadTags, clearError]
  );

  const toggleTodo = useCallback(
    (note: Note) => {
      void api
        .toggleTodo(note.id)
        .then((updated) => {
          if (updated) applyNoteChange(updated);
          clearError('action');
          loadTags();
        })
        .catch((e) => setError('action', '切换待办状态失败: ' + String(e)));
    },
    [applyNoteChange, loadTags, clearError]
  );

  /** 编辑保存:用命令返回的就地更新,不重置分页(用户滚到深处编辑不会被弹回顶部) */
  const onEditSaved = useCallback(
    (note: Note) => {
      applyNoteChange(note);
      setEditingId(null);
      clearError('action');
      loadTags();
    },
    [applyNoteChange, loadTags, clearError]
  );

  return (
    <div className="mx-auto flex h-screen w-full max-w-3xl flex-col bg-white text-gray-900">
      <TopBar
        view={view}
        onOpenSettings={() => setView('settings')}
        onBack={() => setView('stream')}
      />
      {/* 信息流始终挂载:切到设置页只是隐藏,返回时分页与滚动位置都不丢(不重新查询) */}
      <div className={view === 'stream' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
      <Composer onSaved={refresh} disabled={editingId !== null} />
      <FilterBar
        conditions={conditions}
        onPatch={patch}
        allTags={allTags}
        onExport={() => void onExport()}
        exporting={exporting}
        exported={exported}
      />
      <ErrorBars errors={errors} onRetry={retry} onDismiss={clearError} />
      <NoteStream
        notes={notes}
        queryFailed={queryFailed}
        onRetry={retry}
        activeTags={conditions.tags.map((t) => t.path)}
        editingId={editingId}
        hasMore={hasMore}
        loading={loading}
        onLoadMore={loadMore}
        onTagClick={toggleTag}
        onEdit={(n) => setEditingId(n.id)}
        onDelete={remove}
        onToggleTodo={toggleTodo}
        onEditSaved={onEditSaved}
        onEditCancel={() => setEditingId(null)}
        onLinkError={(m) => setError('action', m)}
      />
      </div>
      {view === 'settings' && <SettingsView />}
    </div>
  );
}

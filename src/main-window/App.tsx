import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import { EMPTY_FILTER, isFilterEmpty } from '../shared/filter-conditions';
import { useThemeMode } from '../shared/use-theme-mode';
import type { TagCount } from '../shared/types';
import { ErrorBars } from './ErrorBars';
import type { MainView } from './settings/settings-model';
import { FilterBar } from './FilterBar';
import { NoteStream } from './NoteStream';
import { SettingsView } from './SettingsView';
import { Sidebar } from './sidebar/Sidebar';
import { rewriteTagPaths } from './sidebar/tag-tree';
import { useSidebarState } from './sidebar/use-sidebar-state';
import { TopBar } from './TopBar';
import { Composer } from './Composer';
import { useNoteActions } from './use-note-actions';
import { useAppErrors } from './use-app-errors';
import { useBackupWarning } from './use-backup-warning';
import { useNoteCreatedRefresh } from './use-note-created';
import { useOpenSettings } from './use-open-settings';
import { useNotesFeed } from './use-notes-feed';
import { useFilterConditions } from './use-filter-conditions';
import { useNotesExport } from './use-export';

/** 主窗 v2:侧栏(视图/标签)+ 单列流(Composer + FilterBar + NoteStream) */
export function App(): ReactNode {
  // 筛选条件真源(含 filter_last 持久化):标签、排序、分页查询都从它派生
  const { conditions, patch, toggleTag } = useFilterConditions();
  const sidebar = useSidebarState();
  const [tagRows, setTagRows] = useState<TagCount[]>([]);
  const [dataVersion, setDataVersion] = useState(0); // 标签/笔记数据变更信号(侧栏徽标据此重载)
  const { errors, setError, clearError } = useAppErrors();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [view, setView] = useState<MainView>('stream');
  // 主题三态:主窗持有并广播给输入栏(见 shared/use-theme-mode);挂载即读库应用
  const theme = useThemeMode({ broadcast: true, onError: (m) => setError('action', m) });

  const { exporting, exported, onExport } = useNotesExport(setError, clearError);
  const { notes, setNotes, hasMore, loading, queryFailed, fetchPage, loadMore, retry } =
    useNotesFeed(conditions, setError, clearError);

  const loadTags = useCallback(() => {
    void api
      .listTags()
      .then((rows) => {
        setTagRows(rows);
        setDataVersion((v) => v + 1);
        clearError('tags');
      })
      .catch((e) => setError('tags', '标签加载失败: ' + String(e)));
  }, [clearError, setError]);

  // 筛选变化:退出编辑态(列表重查由 useNotesFeed 负责)
  useEffect(() => {
    setEditingId(null);
  }, [conditions]);

  useEffect(loadTags, [loadTags]);
  useBackupWarning(setError);

  /** 新增笔记后回第一页(新内容必在最前);就地变更走 replaceNote,不重置分页与滚动位置 */
  const refresh = useCallback(() => {
    setEditingId(null);
    void fetchPage(0, false);
    loadTags();
  }, [fetchPage, loadTags]);

  // 输入栏保存后主窗自动出现(W1);已翻页或正在编辑时由 shouldAutoRefresh 拦下
  useNoteCreatedRefresh(notes.length, editingId, refresh, (m) => setError('action', m));

  /** 托盘「设置」菜单:窗口已由 Rust 显示,这里只切视图 */
  const openSettings = useCallback(() => setView('settings'), []);
  const reportSettingsError = useCallback((m: string) => setError('action', m), [setError]);
  useOpenSettings(openSettings, reportSettingsError);

  /** 空库引导:显示(不切换)输入栏;失败走既有错误条 */
  const showInput = useCallback(() => {
    void api.showInputWindow().catch((e) => setError('action', '唤起输入栏失败: ' + String(e)));
  }, [setError]);

  /** 空库引导:清空全部筛选条件(排序也回默认) */
  const clearFilters = useCallback(() => patch(EMPTY_FILTER), [patch]);

  const { remove, toggleTodo, onEditSaved, setDate, dateFlash } = useNoteActions({
    conditions,
    fetchPage,
    setNotes,
    setEditingId,
    reload: loadTags,
    setError,
    clearError,
  });

  /** 标签改名/移动/删除成功:刷新标签树与徽标,并把当前筛选条件里的旧路径级联改写 */
  const handleTagsMutated = useCallback(
    (pathChange?: { from: string; to: string }) => {
      loadTags();
      if (pathChange) patch(rewriteTagPaths(conditions, pathChange.from, pathChange.to));
    },
    [loadTags, patch, conditions]
  );

  /** 应用视图条件:整体替换(视图就是一份完整条件对象) */
  const applyView = useCallback((c: typeof conditions) => patch(c), [patch]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-app text-text">
      <Sidebar
        sidebar={sidebar}
        conditions={conditions}
        onPatch={patch}
        tagRows={tagRows}
        dataVersion={dataVersion}
        onTagsMutated={handleTagsMutated}
        onApplyView={applyView}
      />
      {/* 内容区 min-w 保护:窄窗口下侧栏允许被压缩,内容区不被挤没 */}
      <div className="mx-auto flex h-full w-full min-w-[420px] max-w-3xl flex-1 flex-col">
        <TopBar
          view={view}
          sidebarVisible={sidebar.visible}
          onToggleSidebar={() => sidebar.setVisible(!sidebar.visible)}
          onOpenSettings={() => setView('settings')}
          onBack={() => setView('stream')}
        />
        {/* 信息流始终挂载:切到设置页只是隐藏,返回时分页与滚动位置都不丢(不重新查询) */}
        <div className={view === 'stream' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <Composer onSaved={refresh} disabled={editingId !== null} />
          <FilterBar
            conditions={conditions}
            onPatch={patch}
            onExport={() => void onExport()}
            exporting={exporting}
            exported={exported}
          />
          <ErrorBars errors={errors} onRetry={retry} onDismiss={clearError} />
          {dateFlash && (
            <div role="status" className="px-4 pt-1 text-xs text-success">
              日期已更新
            </div>
          )}
          <NoteStream
            notes={notes}
            queryFailed={queryFailed}
            filterEmpty={isFilterEmpty(conditions)}
            onRetry={retry}
            onClearFilters={clearFilters}
            onShowInput={showInput}
            activeTags={conditions.tags.map((t) => t.path)}
            editingId={editingId}
            hasMore={hasMore}
            loading={loading}
            onLoadMore={loadMore}
            onTagClick={toggleTag}
            onEdit={(n) => setEditingId(n.id)}
            onDelete={remove}
            onToggleTodo={toggleTodo}
            onDateChange={setDate}
            onEditSaved={onEditSaved}
            onEditCancel={() => setEditingId(null)}
            onLinkError={(m) => setError('action', m)}
          />
        </div>
        {view === 'settings' && (
          <SettingsView themeMode={theme.mode} onThemeChange={theme.setMode} />
        )}
      </div>
    </div>
  );
}

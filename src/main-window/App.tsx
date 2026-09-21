import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import { EMPTY_FILTER, isFilterEmpty } from '../shared/filter-conditions';
import { useThemeMode } from '../shared/use-theme-mode';
import type { Note, TagCount } from '../shared/types';
import { ErrorBars } from './shell/ErrorBars';
import type { MainView } from './settings/settings-model';
import { FilterBar } from './filter/FilterBar';
import { NoteStream } from './stream/NoteStream';
import { SettingsView } from './settings/SettingsView';
import { Sidebar } from './sidebar/Sidebar';
import { useSidebarState } from './sidebar/use-sidebar-state';
import { TabsBar } from './tabs/TabsBar';
import { useTabs } from './tabs/use-tabs';
import { TopBar } from './shell/TopBar';
import { Composer } from './stream/Composer';
import { useNoteActions } from './data/use-note-actions';
import { useAppErrors } from './shell/use-app-errors';
import { useBackupWarning } from './shell/use-backup-warning';
import { useNoteCreatedRefresh } from './data/use-note-created';
import { useOpenSettings } from './shell/use-open-settings';
import { useNotesFeed } from './data/use-notes-feed';
import { useNotesExport } from './data/use-export';

/** 主窗 v2:侧栏(标签)+ 标签页栏 + 单列流(Composer + FilterBar + NoteStream) */
export function App(): ReactNode {
  // 标签页真源(S7):当前活动页的条件就是唯一条件对象,查询/筛选栏/侧栏选中态都从它派生
  const tabs = useTabs();
  const { conditions, patch, toggleTag, reload: reloadTabs } = tabs;
  const sidebar = useSidebarState();
  const [tagRows, setTagRows] = useState<TagCount[]>([]);
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
        clearError('tags');
      })
      .catch((e) => setError('tags', '标签加载失败: ' + String(e)));
  }, [clearError, setError]);

  // 条件变化(含切换标签页):退出编辑态(列表重查由 useNotesFeed 负责)
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

  /** 空库引导:清空当前标签页的全部筛选条件(排序也回默认) */
  const clearFilters = useCallback(() => patch(EMPTY_FILTER), [patch]);

  const { remove, onEditSaved, toggleTask } = useNoteActions({
    conditions,
    fetchPage,
    setNotes,
    setEditingId,
    reload: loadTags,
    setError,
    clearError,
  });

  /**
   * 点正文进编辑:编辑面板在场时面板的提交守卫接管(点另一条 = 先存后进),这里不抢 ——
   * 用函数式更新读最新值,避免同一 tick 里已被排队清空的旧 editingId。
   */
  const requestEdit = useCallback((n: Note) => {
    setEditingId((prev) => (prev === null ? n.id : prev));
  }, []);
  /** 编辑面板已提交成功后的切换(内容未变时也走这条):不受上述守卫限制 */
  const switchEdit = useCallback((n: Note) => setEditingId(n.id), []);

  /**
   * 标签改名/移动/删除成功:刷新标签树;改名/移动时各标签页条件里的路径已由 Rust
   * 在同一事务里重写(tabs_rewrite),这里重读 settings 即同步 —— 前端不重复实现一套重写。
   */
  const handleTagsMutated = useCallback(
    (pathChange?: { from: string; to: string }) => {
      loadTags();
      if (pathChange) reloadTabs();
    },
    [loadTags, reloadTabs]
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-app text-text">
      <Sidebar
        sidebar={sidebar}
        conditions={conditions}
        onPatch={patch}
        tagRows={tagRows}
        onTagsMutated={handleTagsMutated}
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
          <TabsBar
            tabs={tabs.tabs}
            activeIndex={tabs.activeIndex}
            onActivate={tabs.activate}
            onClose={tabs.close}
            onMove={tabs.move}
            onRename={tabs.rename}
            onPreset={tabs.addPreset}
            onAddCurrent={tabs.addFromCurrent}
          />
          <Composer onSaved={refresh} disabled={editingId !== null} />
          <FilterBar
            conditions={conditions}
            onPatch={patch}
            onExport={() => void onExport()}
            exporting={exporting}
            exported={exported}
          />
          <ErrorBars errors={errors} onRetry={retry} onDismiss={clearError} />
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
            onEdit={requestEdit}
            onSwitchEdit={switchEdit}
            onDelete={remove}
            onEditSaved={onEditSaved}
            onEditCancel={() => setEditingId(null)}
            onToggleTask={toggleTask}
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

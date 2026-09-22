import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import { EMPTY_FILTER, isFilterEmpty } from '../shared/filter-conditions';
import { useThemeMode } from '../shared/use-theme-mode';
import type { TagCount } from '../shared/types';
import { CommandStatusPill } from './shell/CommandStatusPill';
import type { MainView } from './settings/settings-model';
import { SettingsView } from './settings/SettingsView';
import { Sidebar } from './sidebar/Sidebar';
import { useSidebarState } from './sidebar/use-sidebar-state';
import { StreamView } from './shell/StreamView';
import { useTabs } from './tabs/use-tabs';
import { TopBar } from './shell/TopBar';
import { useAppErrors } from './shell/use-app-errors';
import { useAppCommands } from './shell/use-app-commands';
import { useEditFlow } from './shell/use-edit-flow';
import { useMainPalette } from './shell/use-main-palette';
import { useBackupWarning } from './shell/use-backup-warning';
import { useNoteCreatedRefresh } from './data/use-note-created';
import { useOpenSettings } from './shell/use-open-settings';
import { Palette } from './palette/Palette';
import { useNotesFeed } from './data/use-notes-feed';
import { useNotesExport } from './data/use-export';

/** 主窗 v2:侧栏(标签)+ 标签页栏 + 单列流(Composer + FilterBar + NoteStream)+ 命令面板浮层 */
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

  const { remove, onEditSaved, toggleTask, requestEdit, switchEdit, handleTagsMutated } = useEditFlow({
    conditions,
    fetchPage,
    setNotes,
    setEditingId,
    reloadTags: loadTags,
    reloadTabs,
    setError,
    clearError,
  });

  // 命令副作用(11 条):注册表在构造期校验「全部接线」,漏一条即抛
  const commands = useAppCommands({
    tabs: { count: tabs.tabs.length, activeIndex: tabs.activeIndex, activate: tabs.activate },
    sidebar: { visible: sidebar.visible, setVisible: sidebar.setVisible },
    theme: { mode: theme.mode, setMode: theme.setMode },
    setView,
    exportAll: onExport,
    setError,
  });

  // 主区容器 = 浮层关闭时的焦点归位锚点(tabIndex=-1 才可聚焦;可见焦点环见 className)
  const anchorRef = useRef<HTMLDivElement>(null);
  const { controller, decorations } = useMainPalette({
    anchorRef,
    registry: commands.registry,
    executeCommand: commands.execute,
    tabCount: tabs.tabs.length,
    sidebarVisible: sidebar.visible,
    editingId,
    notes,
    loadingNotes: loading,
    conditions,
    clearFilters,
    toggleTag,
    setError,
  });

  return (
    <div className="flex h-screen w-full overflow-hidden bg-app text-text">
      <Sidebar
        sidebar={sidebar}
        conditions={conditions}
        onPatch={patch}
        tagRows={tagRows}
        onTagsMutated={handleTagsMutated}
      />
      {/* 内容区 min-w 保护:窄窗口下侧栏允许被压缩,内容区不被挤没;
          同时是浮层关闭时的焦点归位锚点(键盘关闭 -> 焦点回主区,焦点环可见) */}
      <div
        ref={anchorRef}
        tabIndex={-1}
        className="mx-auto flex h-full w-full min-w-[420px] max-w-3xl flex-1 flex-col outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <TopBar
          view={view}
          sidebarVisible={sidebar.visible}
          onToggleSidebar={() => sidebar.setVisible(!sidebar.visible)}
          onOpenSettings={() => setView('settings')}
          onBack={() => setView('stream')}
        />
        <StreamView
          visible={view === 'stream'}
          tabs={tabs}
          conditions={conditions}
          notes={notes}
          editingId={editingId}
          hasMore={hasMore}
          loading={loading}
          queryFailed={queryFailed}
          filterEmpty={isFilterEmpty(conditions)}
          exporting={exporting}
          exported={exported}
          errors={errors}
          onPatch={patch}
          onToggleTag={toggleTag}
          onExport={() => void onExport()}
          onRetry={retry}
          onDismissError={clearError}
          onClearFilters={clearFilters}
          onShowInput={showInput}
          onLoadMore={loadMore}
          onEdit={requestEdit}
          onSwitchEdit={switchEdit}
          onDelete={remove}
          onEditSaved={onEditSaved}
          onEditCancel={() => setEditingId(null)}
          onToggleTask={toggleTask}
          onLinkError={(m) => setError('action', m)}
          onSaved={refresh}
        />
        {view === 'settings' && (
          <SettingsView themeMode={theme.mode} onThemeChange={theme.setMode} />
        )}
      </div>
      {/* 浮层挂在 shell 层(fixed 覆盖内容,不进布局),不塞进内容区 */}
      <Palette controller={controller} decorations={decorations} />
      <CommandStatusPill status={commands.status} />
    </div>
  );
}

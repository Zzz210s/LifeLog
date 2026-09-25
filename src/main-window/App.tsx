import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { isFilterEmpty } from '../shared/filter-conditions';
import { useThemeMode } from '../shared/use-theme-mode';
import { CommandStatusPill } from './shell/CommandStatusPill';
import type { MainView } from './settings/settings-model';
import { SettingsView } from './settings/SettingsView';
import { Sidebar } from './sidebar/Sidebar';
import { useSidebarState } from './sidebar/use-sidebar-state';
import { StreamView } from './shell/StreamView';
import { contentColumnClass } from './shell/content-column';
import { useTabs } from './tabs/use-tabs';
import { TopBar } from './shell/TopBar';
import { topBarMenuItems } from './shell/TopBarMenu';
import { useAppErrors } from './shell/use-app-errors';
import { useAppCommands } from './shell/use-app-commands';
import { useAddConditionMenu } from './shell/use-add-condition-menu';
import { useEditFlow } from './shell/use-edit-flow';
import { useMainPalette } from './shell/use-main-palette';
import { useBackupWarning } from './shell/use-backup-warning';
import { useNoteCreatedRefresh } from './data/use-note-created';
import { notifyTagsChanged } from './data/tags-changed';
import { useTagRows } from './data/use-tag-rows';
import { useOpenSettings } from './shell/use-open-settings';
import { useNotesFeed } from './data/use-notes-feed';
import { useNotesExport } from './data/use-export';
import { useStreamActions } from './shell/use-stream-actions';
import { TutorialLayer } from './tutorial/TutorialLayer';
import { useTutorialEntry } from './tutorial/use-tutorial-entry';

/** 主窗 v2:侧栏(标签)+ 标签页栏 + 单列流(统一输入框 + 条件栏 + NoteStream);候选下拉在输入框内 */
export function App(): ReactNode {
  // 标签页真源(S7):当前活动页的条件就是唯一条件对象,查询/筛选栏/侧栏选中态都从它派生
  const tabs = useTabs();
  const { conditions, patch, toggleTag, reload: reloadTabs } = tabs;
  const sidebar = useSidebarState();
  const { errors, setError, clearError } = useAppErrors();
  // 标签树数据与版本号(版本号是 `#` 候选池的作废键;重载只由 tags-changed 唯一出口驱动)
  const { tagRows, tagsVersion } = useTagRows(setError, clearError);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [view, setView] = useState<MainView>('stream');
  // 主题三态:主窗持有并广播给输入栏(见 shared/use-theme-mode);挂载即读库应用
  const theme = useThemeMode({ broadcast: true, onError: (m) => setError('action', m) });

  const { exporting, exported, onExport } = useNotesExport(setError, clearError);
  const { notes, setNotes, hasMore, loading, queryFailed, fetchPage, loadMore, retry } =
    useNotesFeed(conditions, setError, clearError);

  // 条件变化(含切换标签页):退出编辑态(列表重查由 useNotesFeed 负责)
  useEffect(() => {
    setEditingId(null);
  }, [conditions]);

  useBackupWarning(setError);

  // 信息流的三条命令式动作(回第一页/唤起输入栏/清筛选):接线在 shell/use-stream-actions
  const { refresh, showInput, clearFilters } = useStreamActions({
    fetchPage,
    patch,
    resetEditing: setEditingId,
    setError,
  });

  // 输入栏保存后主窗自动出现(W1);已翻页或正在编辑时由 shouldAutoRefresh 拦下
  useNoteCreatedRefresh(notes.length, editingId, refresh, (m) => setError('action', m));

  /** 托盘「设置」菜单:窗口已由 Rust 显示,这里只切视图 */
  const openSettings = useCallback(() => setView('settings'), []);
  const reportSettingsError = useCallback((m: string) => setError('action', m), [setError]);
  useOpenSettings(openSettings, reportSettingsError);
  // 首次使用引导:主窗自己读标记决定挂不挂层(开窗在 Rust 启动路径);用户动作写标记、「重新观看」先回信息流
  // 回调身份要稳(重看入口把它透传到设置页;每渲染换新会让下游 props 每次变)
  const backToStream = useCallback(() => setView('stream'), []);
  const tutorial = useTutorialEntry(backToStream);

  // 引导开着时切到设置页(托盘「设置」是 OS 级通道,拦不住键盘闸门)会把锚点全藏起来 ——
  // 覆盖层会变成"全屏压暗 + 气泡悬空"。这时按"不可用"处理:**只关层、不写标记**,下次启动再弹。
  useEffect(() => {
    if (view === 'settings' && tutorial.open) tutorial.onUnavailable();
  }, [view, tutorial]);

  const { remove, onEditSaved, toggleTask, requestEdit, switchEdit, handleTagsMutated } = useEditFlow({
    conditions,
    fetchPage,
    setNotes,
    setEditingId,
    reloadTags: notifyTagsChanged,
    reloadTabs,
    setError,
    clearError,
  });

  // 命令副作用(14 条):注册表在构造期校验「全部接线」,漏一条即抛
  const commands = useAppCommands({
    tabs: { count: tabs.tabs.length, activeIndex: tabs.activeIndex, activate: tabs.activate },
    sidebar: { visible: sidebar.visible, setVisible: sidebar.setVisible },
    theme: { mode: theme.mode, setMode: theme.setMode },
    setView,
    onPatch: patch,
    exportAll: onExport,
    setError,
  });
  // 「添加条件」命令的一次性信号 -> 条件栏菜单开关(打开即复位)
  const addCondition = useAddConditionMenu(commands);
  // 顶栏溢出菜单四条:标题与勾选态取自命令表,执行走同一条 commands.execute(与 `>` 一致)
  const menuItems = topBarMenuItems({ sort: conditions.sort, exporting, run: (id) => void commands.execute(id) });

  // 候选控制器/装饰 + 快捷键接线(prefill 是唯一入口;采纳副作用在 StreamView)
  const { controller, decorations, unified, prefill } = useMainPalette({
    registry: commands.registry,
    beforePrefill: () => setView('stream'),
    tagsVersion,
    conditions,
    tabCount: tabs.tabs.length,
    sidebarVisible: sidebar.visible,
    editingId,
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
        onPrefill={prefill}
      />
      {/* 内容区 min-w 保护:窄窗口下侧栏允许被压缩,内容区不被挤没;
          列宽随侧栏显隐切换(有侧栏 768 / 无侧栏 1024,视觉刷新 V4) */}
      <div
        tabIndex={-1}
        className={`mx-auto flex h-full w-full min-w-[420px] flex-1 flex-col outline-none focus-visible:ring-1 focus-visible:ring-accent ${contentColumnClass(sidebar.visible)}`}
      >
        <TopBar
          view={view}
          sidebarVisible={sidebar.visible}
          menuItems={menuItems}
          exporting={exporting}
          exported={exported}
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
          errors={errors}
          onPatch={patch}
          onToggleTag={toggleTag}
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
          palette={controller}
          decorations={decorations}
          onSaved={refresh}
          onRunCommand={commands.execute}
          addConditionOpen={addCondition.open}
          onAddConditionOpenChange={addCondition.setOpen}
          unifiedRef={unified}
        />
        {view === 'settings' && (
          <SettingsView
            themeMode={theme.mode}
            onThemeChange={theme.setMode}
            onReplayTutorial={tutorial.onReplay}
          />
        )}
      </div>
      <CommandStatusPill status={commands.status} />
      {/* 条件挂载:重看时重新挂载,引导层内部状态(当前步/已执行的前置动作)自然复位 */}
      {tutorial.open && (
        <TutorialLayer
          open
          onExit={tutorial.onExit}
          onUnavailable={tutorial.onUnavailable}
          onShowSidebar={() => sidebar.setVisible(true)}
        />
      )}
    </div>
  );
}

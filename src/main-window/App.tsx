import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { isFilterEmpty } from '../shared/filter-conditions';
import { useThemeMode } from '../shared/use-theme-mode';
import { CommandStatusPill } from './shell/CommandStatusPill';
import { emit } from '@tauri-apps/api/event';
import type { MainView } from './settings/settings-model';
import { Sidebar } from './sidebar/Sidebar';
import { useSearchRowHeight } from './data/use-search-row-height';
import { useSidebarState } from './sidebar/use-sidebar-state';
import { useTagClick } from './sidebar/use-tag-click';
import { ViewHost } from './shell/ViewHost';
import { useFilterState } from './filter/use-filter-state';
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
import { useStreamFeed } from './data/use-stream-feed';
import { useBatchModes } from './filter/use-batch-modes';
import { useNotesExport } from './data/use-export';
import { useStreamActions } from './shell/use-stream-actions';
import { HoverTip } from './shell/HoverTip';
import { TutorialLayer } from './tutorial/TutorialLayer';
import { useAppTutorial } from './shell/use-app-tutorial';

/** 主窗 v2 外壳:侧栏(标签)+ 内容区(顶栏 + 视图分派在 shell/ViewHost);候选下拉在输入框内 */
export function App(): ReactNode {
  // 筛选条件真源(单份,库键 filter_current):查询/条件栏/侧栏选中态都从它派生
  const { conditions, patch, toggleTag, reload: reloadFilter } = useFilterState();
  const sidebar = useSidebarState();
  const searchRow = useSearchRowHeight();
  const { errors, setError, clearError } = useAppErrors();
  // 标签树数据与版本号(版本号是 `#` 候选池的作废键;重载只由 tags-changed 唯一出口驱动)
  const { tagRows, tagsVersion } = useTagRows(setError, clearError);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [view, setView] = useState<MainView>('stream');
  // 主题三态:主窗持有并广播给输入栏(见 shared/use-theme-mode);挂载即读库应用
  const theme = useThemeMode({ broadcast: true, onError: (m) => setError('action', m) });

  const { exporting, exported, onExport } = useNotesExport(setError, clearError);
  const { notes, setNotes, hasMore, loading, queryFailed, fetchPage, loadMore, retry, grouping, notice } =
    useStreamFeed(conditions, setError, clearError);

  // 条件变化:退出编辑态(列表重查由 useNotesFeed 负责)
  useEffect(() => setEditingId(null), [conditions]);

  useBackupWarning(setError);

  // 信息流的三条命令式动作(回第一页/唤起输入栏/清筛选):接线在 shell/use-stream-actions
  const { refresh, showInput, clearFilters } = useStreamActions({
    fetchPage,
    patch,
    resetEditing: setEditingId,
    setError,
  });

  // 批量编辑(spec 2026-10-17):会话内状态,不落库;切筛选/Esc 退出并清选中。
  // 条目批量与条件批量互斥(后开的一方关掉另一方),接线集中在 use-batch-modes
  const batchModes = useBatchModes({ conditions, notes, refresh, onPatch: patch });

  // 输入栏保存后主窗自动出现(W1);已翻页或正在编辑时由 shouldAutoRefresh 拦下
  useNoteCreatedRefresh(notes.length, editingId, refresh, (m) => setError('action', m));

  /** 托盘「设置」菜单:窗口已由 Rust 显示,这里只切视图 */
  const openSettings = useCallback(() => setView('settings'), []);
  const reportSettingsError = useCallback((m: string) => setError('action', m), [setError]);
  useOpenSettings(openSettings, reportSettingsError);
  // 引导层 + 「回信息流 / 筛到信息流」两个视图动作(接线与锚点守卫都在 shell/use-app-tutorial)
  const { backToStream, filterToStream, tutorial } = useAppTutorial({ view, setView, toggleTag });

  // 侧栏单击接线(设计 2026-10-16,计划 T4):光标 / 预览不落库;侧栏、设置页与信息流共用这一份
  const click = useTagClick(sidebar, { conditions, onPatch: patch, rows: tagRows,
    inStream: view === 'stream', openStream: backToStream });

  const { remove, onEditSaved, toggleTask, requestEdit, switchEdit, handleTagsMutated } = useEditFlow({
    conditions,
    fetchPage,
    setNotes,
    setEditingId,
    reloadTags: notifyTagsChanged,
    reloadFilter,
    setError,
    clearError,
  });

  // 命令副作用(13 条):注册表在构造期校验「全部接线」,漏一条即抛
  const commands = useAppCommands({
    sidebar: { visible: sidebar.visible, setVisible: sidebar.setVisible },
    theme: { mode: theme.mode, setMode: theme.setMode },
    setView,
    onPatch: patch,
    exportAll: onExport,
    setError,
  });
  // 切库后重载:主窗与输入栏两个窗口都要重载 —— 它们各自持有一份前端状态,
  // 只重载主窗会留下"输入栏还写着上一个库的内容"(后端连接已经换了)
  const reloadAfterLibrarySwitch = (): void => {
    void emit('library-switched').catch(() => {});
    window.location.reload();
  };

  // 「添加条件」命令的一次性信号 -> 条件栏菜单开关(打开即复位)
  const addCondition = useAddConditionMenu(commands);

  // 候选控制器/装饰 + 快捷键接线(prefill 是唯一入口;采纳副作用在 StreamView)
  const { controller, decorations, tagMru, unified, prefill } = useMainPalette({
    registry: commands.registry,
    beforePrefill: () => setView('stream'),
    tagsVersion,
    conditions,
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
        tagMru={tagMru}
        onTagsMutated={handleTagsMutated}
        onPrefill={prefill}
        click={click}
      />
      {/* 内容区外壳与顶栏在 ViewHost(列宽与顶栏的三个入口都是视图动作);这里只传侧栏状态与各组接线 */}
      <ViewHost
        view={view}
        sidebarVisible={sidebar.visible}
        topBar={{ exporting, exported }}
        onToggleSidebar={() => sidebar.setVisible(!sidebar.visible)}
        onOpenSettings={openSettings}
        onOpenGraph={() => void commands.execute('graph.open')}
        onBack={backToStream}
        stream={{
          conditions,
          notes,
          editingId,
          hasMore,
          loading,
          queryFailed,
          grouping, notice, preview: click.preview,
          filterEmpty: isFilterEmpty(conditions),
          errors,
          onPatch: patch,
          onToggleTag: toggleTag,
          onRetry: retry,
          onDismissError: clearError,
          onClearFilters: clearFilters,
          onShowInput: showInput,
          onLoadMore: loadMore,
          onEdit: requestEdit,
          onSwitchEdit: switchEdit,
          onDelete: remove,
          onEditSaved,
          onEditCancel: () => setEditingId(null),
          onToggleTask: toggleTask,
          onLinkError: (m) => setError('action', m),
          palette: controller,
          decorations,
          batchModes,
          searchRowHeight: searchRow.height,
          onSaved: refresh,
          onRunCommand: commands.execute,
          addConditionOpen: addCondition.open,
          onAddConditionOpenChange: addCondition.setOpen,
          unifiedRef: unified,
        }}
        theme={theme}
        onReplayTutorial={tutorial.onReplay}
        onLibrarySwitched={reloadAfterLibrarySwitch}
        tagTreeRelations={{ showRelations: sidebar.showRelations, onShowRelationsChange: sidebar.setShowRelations }}
        sidebarClick={{ clickMode: sidebar.clickMode, onChangeClickMode: click.changeClickMode }}
        maintenance={{ exportAll: onExport, exporting, focus: { on: commands.focusOn, toggle: () => void commands.execute('focus.mode') } }}
        searchRow={{ height: searchRow.height, onChange: searchRow.setHeight, onReset: searchRow.reset }}
        onFilterToStream={filterToStream}
        dataVersion={tagsVersion}
        tagMru={tagMru}
      />
      <CommandStatusPill status={commands.status} />
      {/* 瞬时悬浮提示(标签名里的备注字):原生 title 延迟约 1 秒,这里走 data-tip 事件委托 */}
      <HoverTip />
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

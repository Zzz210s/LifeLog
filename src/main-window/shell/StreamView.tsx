/**
 * 信息流视图(自 App.tsx 抽出以留出行数余量:App 要挂浮层与快捷键接线)。
 * 纯搬移 + 透传 props,不改行为:信息流**始终挂载**,切到设置页只是 `hidden`(返回时分页与滚动位置都不丢)。
 */
import type { ReactNode } from 'react';
import type { Note } from '../../shared/types';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { RowDecoration } from '../palette/PaletteRow';
import type { PaletteController } from '../palette/use-palette';
import { UnifiedInput } from '../unified/UnifiedInput';
import { NoteStream } from '../stream/NoteStream';
import { FilterBar } from '../filter/FilterBar';
import { ErrorBars } from './ErrorBars';
import { TabsBar } from '../tabs/TabsBar';
import type { TabsApi } from '../tabs/use-tabs';
import type { ErrorKind } from './ErrorBar';
import type { ErrorMap } from './errors';

export interface StreamViewProps {
  visible: boolean;
  tabs: TabsApi;
  conditions: FilterConditions;
  notes: Note[];
  editingId: number | null;
  hasMore: boolean;
  loading: boolean;
  queryFailed: boolean;
  filterEmpty: boolean;
  exporting: boolean;
  exported: boolean;
  errors: ErrorMap;
  onPatch: (value: Partial<FilterConditions>) => void;
  onToggleTag: (path: string) => void;
  onExport: () => void;
  onRetry: () => void;
  onDismissError: (kind: ErrorKind) => void;
  onClearFilters: () => void;
  onShowInput: () => void;
  onLoadMore: () => void;
  onEdit: (note: Note) => void;
  onSwitchEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onEditSaved: (note: Note) => void;
  onEditCancel: () => void;
  onToggleTask: (note: Note, index: number) => void;
  onLinkError: (message: string) => void;
  /** 浮层控制器:统一输入框的候选/高亮/采纳状态与它共用(浮层本任务保持不打开) */
  palette: PaletteController;
  /** 候选行装饰(命令快捷键/标签计数/笔记日期) */
  decorations: Readonly<Record<string, RowDecoration>>;
  /** 标签数据版本(`#` 候选池作废键,与 useAppPalette 同值) */
  tagsVersion: number;
  /** 统一输入框保存成功后刷新(回第一页 + 重读标签) */
  onSaved: () => void;
}

export function StreamView(p: StreamViewProps): ReactNode {
  const t = p.tabs;
  return (
    <div className={p.visible ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
      <TabsBar
        tabs={t.tabs}
        activeIndex={t.activeIndex}
        onActivate={t.activate}
        onClose={t.close}
        onMove={t.move}
        onRename={t.rename}
        onPreset={t.addPreset}
        onAddCurrent={t.addFromCurrent}
      />
      <UnifiedInput
        onSaved={p.onSaved}
        editing={p.editingId !== null}
        candidates={{ palette: p.palette, decorations: p.decorations, refreshKey: p.tagsVersion, onError: p.onLinkError }}
      />
      <FilterBar
        conditions={p.conditions}
        onPatch={p.onPatch}
        onExport={p.onExport}
        exporting={p.exporting}
        exported={p.exported}
      />
      <ErrorBars errors={p.errors} onRetry={p.onRetry} onDismiss={p.onDismissError} />
      <NoteStream
        notes={p.notes}
        queryFailed={p.queryFailed}
        filterEmpty={p.filterEmpty}
        onRetry={p.onRetry}
        onClearFilters={p.onClearFilters}
        onShowInput={p.onShowInput}
        activeTags={p.conditions.tags.map((tag) => tag.path)}
        editingId={p.editingId}
        hasMore={p.hasMore}
        loading={p.loading}
        onLoadMore={p.onLoadMore}
        onTagClick={p.onToggleTag}
        onEdit={p.onEdit}
        onSwitchEdit={p.onSwitchEdit}
        onDelete={p.onDelete}
        onEditSaved={p.onEditSaved}
        onEditCancel={p.onEditCancel}
        onToggleTask={p.onToggleTask}
        onLinkError={p.onLinkError}
      />
    </div>
  );
}

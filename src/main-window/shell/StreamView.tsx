/**
 * 信息流视图(自 App.tsx 抽出以留出行数余量:App 要挂浮层与快捷键接线)。
 * 纯搬移 + 透传 props,不改行为:信息流**始终挂载**,切到设置页只是 `hidden`(返回时分页与滚动位置都不丢)。
 *
 * Task 6:统一输入框的采纳副作用与 `/` 实时筛选在这里落地。决策与执行分开 —— 决策是纯函数
 * `effectFor`(可单测),执行(滚到笔记 / 打条件补丁 / 跑既有命令 + MRU 记账)都在本容器里。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Note } from '../../shared/types';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { InputMode } from '../../shared/input-prefix';
import type { RowDecoration } from '../palette/PaletteRow';
import type { PaletteController } from '../palette/use-palette';
import { usePaletteSettings } from '../palette/use-palette-settings';
import { UnifiedInput } from '../unified/UnifiedInput';
import { effectFor } from '../unified/unified-accept';
import { NoteStream } from '../stream/NoteStream';
import { scrollIntoViewIfNeeded } from '../stream/scroll-to-note';
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
  /** `>` 采纳后执行既有命令(use-app-commands 的 execute:先 flush 编辑态,失败落错误条) */
  onRunCommand: (id: string) => void;
}

/** `/` 实时筛选的防抖窗口(与旧 FilterBar 同口径) */
export const FILTER_DEBOUNCE_MS = 300;

export function StreamView(p: StreamViewProps): ReactNode {
  const t = p.tabs;
  // 统一输入框的模式与 query(它经 onStateChange 上报):采纳决策与筛选防抖都从这里取。
  // 去重:同一对值不换对象,免得每次重渲染都把 NoteStream 带着重画。
  const [u, setU] = useState<{ mode: InputMode; query: string }>({ mode: 'note', query: '' });
  // props 现读:防抖定时器与采纳回调都可能在很久以后才跑,不能闭包住旧 props
  const latest = useRef(p);
  latest.current = p;
  const timer = useRef<number | null>(null);
  // MRU 记账与浮层同一套设置装配(只在此处标脏,空闲/退出才落盘)
  const { settings, saveMruSoon } = usePaletteSettings();

  /** 模式/query 变化:更新本视图状态;`/` 模式下 300ms 防抖后写 keyword(旧 FilterBar 的定时器写法) */
  const onState = useCallback((s: { mode: InputMode; query: string }) => {
    setU((prev) => (prev.mode === s.mode && prev.query === s.query ? prev : s));
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    // 离开筛选模式就取消挂起的那次:已写进去的关键词留在 chip 上,可单独删
    if (s.mode !== 'filter') return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      latest.current.onPatch({ keyword: s.query });
    }, FILTER_DEBOUNCE_MS);
  }, []);
  // 卸载清理:切设置页/关窗时不留一个还会写条件的定时器
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  // `/` 模式的提示行文案:命中数取 query_notes 返回的长度,排序文案跟随条件
  const stat =
    u.mode === 'filter'
      ? `/ 关键词筛选 · 命中 ${p.notes.length} 条 · ${p.conditions.sort === 'oldest' ? '最早在前' : '最新在前'}`
      : undefined;

  /** 采纳一行:决策在纯函数 `effectFor` 里,执行(滚/补丁/命令 + MRU 记账)都在这里 */
  const acceptAt = (index: number) => {
    const row = p.palette.rows[index];
    if (row === undefined) return; // 行已消失(候选刚被过滤掉):静默,不抛
    const effect = effectFor(u.mode, row, p.conditions);
    if (effect.kind === 'filter-patch') {
      settings?.mruTags.touch(row.item.id);
      saveMruSoon();
      p.onPatch(effect.patch); // 补丁整个透传:`#` 跨侧去重会带 excludeTags,只取 tags 会丢掉那次移除
      return;
    }
    if (effect.kind === 'scroll-to-note') {
      settings?.mruNotes.touch(row.item.id);
      saveMruSoon();
      scrollIntoViewIfNeeded(effect.id);
      return;
    }
    if (effect.kind === 'run-command') {
      settings?.mruCommands.touch(effect.id);
      saveMruSoon();
      void p.onRunCommand(effect.id);
    }
  };

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
        stat={stat}
        onStateChange={onState}
        onAccept={acceptAt}
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

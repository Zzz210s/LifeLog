/**
 * 信息流视图(自 App.tsx 抽出以留出行数余量:App 要挂候选接线与快捷键)。
 * 纯搬移 + 透传 props,不改行为:信息流**始终挂载**,切到设置页只是 `hidden`(返回时分页与滚动位置都不丢)。
 *
 * Task 6:统一输入框的采纳副作用与 `/` 实时筛选在这里落地。决策与执行分开 —— 决策是纯函数
 * `effectFor`(可单测),执行(滚到笔记 / 打条件补丁 / 跑既有命令 + MRU 记账)都在本容器里。
 * 模式/query 镜像与筛选防抖已抽到 `use-unified-filter-sync`(Task 4,守行数红线)。
 */
import { useCallback, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { Note } from '../../shared/types';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { RowDecoration } from '../palette/PaletteRow';
import type { PaletteController } from '../palette/use-palette';
import { usePaletteSettings } from '../palette/use-palette-settings';
import { UnifiedInput } from '../unified/UnifiedInput';
import type { UnifiedController } from '../unified/use-unified-input';
import { effectFor } from '../unified/unified-accept';
import { useUnifiedFilterSync } from './use-unified-filter-sync';
import { useQuickOpen } from '../palette/use-quick-open';
import { NoteStream } from '../stream/NoteStream';
import { ConditionBar } from '../filter/ConditionBar';
import { ErrorBars } from './ErrorBars';
import type { ErrorKind } from './ErrorBar';
import type { ErrorMap } from './errors';

export interface StreamViewProps {
  visible: boolean;
  conditions: FilterConditions;
  notes: Note[];
  editingId: number | null;
  hasMore: boolean;
  loading: boolean;
  queryFailed: boolean;
  filterEmpty: boolean;
  errors: ErrorMap;
  onPatch: (value: Partial<FilterConditions>) => void;
  onToggleTag: (path: string) => void;
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
  /** 候选控制器:统一输入框的候选/高亮状态与它共用(采纳副作用见 acceptAt) */
  palette: PaletteController;
  /** 候选行装饰(命令快捷键/标签计数/笔记日期) */
  decorations: Readonly<Record<string, RowDecoration>>;
  /** 统一输入框保存成功后刷新(回第一页 + 重读标签) */
  onSaved: () => void;
  /** `>` 采纳后执行既有命令(use-app-commands 的 execute:先 flush 编辑态,失败落错误条) */
  onRunCommand: (id: string) => void;
  /** 「添加条件」命令/顶栏菜单上抛的开关(命令消费后由 App 复位) */
  addConditionOpen: boolean;
  onAddConditionOpenChange: (open: boolean) => void;
  /** 统一输入框控制器上抛口(快捷键要 `prefill`):App 持有的 ref,这里只写不读 */
  unifiedRef: RefObject<UnifiedController | null>;
}

export function StreamView(p: StreamViewProps): ReactNode {
  // 统一输入框的模式(query 的防抖写条件在 hook 里):采纳决策与提示行都从这里取
  const { mode, onStateChange } = useUnifiedFilterSync(p.onPatch);
  // props 现读:采纳回调可能在很久以后才跑,不能闭包住旧 props
  const latest = useRef(p);
  latest.current = p;
  // MRU 记账与候选体系同一套设置装配(只在此处标脏,空闲/退出才落盘)
  const { settings, saveMruSoon } = usePaletteSettings();

  // 统一错误出口:useQuickOpen 只按 'action' 来源上报,这里透传给主窗错误条
  const reportAction = useCallback(
    (_kind: ErrorKind, message: string) => latest.current.onLinkError(message),
    [],
  );
  // `@` 采纳的落地:候选池是全库最近 200 条,而流里只有当前条件的第一页 —— 目标常在 DOM 之外。
  // 复用浮层既有的快速打开:命中就滚;不在结果里且有筛选则先清筛选 + 中文提示(不许静默)。
  const openNote = useQuickOpen({
    notes: p.notes,
    loading: p.loading,
    conditions: p.conditions,
    clearFilters: p.onClearFilters,
    setError: reportAction,
  });

  // `/` 模式的提示行文案:命中数取 query_notes 返回的长度,排序文案跟随条件
  const stat =
    mode === 'filter'
      ? `/ 关键词筛选 · 命中 ${p.notes.length} 条 · ${p.conditions.sort === 'oldest' ? '最早在前' : '最新在前'}`
      : undefined;

  /** 采纳一行:决策在纯函数 `effectFor` 里,执行(滚/补丁/命令 + MRU 记账)都在这里 */
  const acceptAt = (index: number) => {
    const row = p.palette.rows[index];
    if (row === undefined) return; // 行已消失(候选刚被过滤掉):静默,不抛
    const effect = effectFor(mode, row, p.conditions);
    if (effect.kind === 'filter-patch') {
      settings?.mruTags.touch(row.item.id);
      saveMruSoon();
      p.onPatch(effect.patch); // 补丁整个透传:`#` 跨侧去重会带 excludeTags,只取 tags 会丢掉那次移除
      return;
    }
    if (effect.kind === 'scroll-to-note') {
      settings?.mruNotes.touch(row.item.id);
      saveMruSoon();
      openNote(effect.id);
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
      <UnifiedInput
        onSaved={p.onSaved}
        editing={p.editingId !== null}
        stat={stat}
        onStateChange={onStateChange}
        onAccept={acceptAt}
        onController={(c) => { p.unifiedRef.current = c; }}
        candidates={{ palette: p.palette, decorations: p.decorations }}
      />
      <ConditionBar
        conditions={p.conditions}
        onPatch={p.onPatch}
        addConditionOpen={p.addConditionOpen}
        onAddConditionOpenChange={p.onAddConditionOpenChange}
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

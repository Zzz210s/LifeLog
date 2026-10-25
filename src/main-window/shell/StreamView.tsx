/**
 * 信息流视图(自 App.tsx 抽出以留出行数余量:App 要挂候选接线与快捷键)。
 * 纯搬移 + 透传 props,不改行为:信息流**始终挂载**,切到设置页只是 `hidden`(返回时分页与滚动位置都不丢)。
 *
 * Task 6:统一输入框的采纳副作用与 `/` 实时筛选在这里落地。决策与执行分开 —— 决策是纯函数
 * `effectFor`(可单测),执行(滚到笔记 / 打条件补丁 / 跑既有命令 + MRU 记账)都在本容器里。
 * 模式/query 镜像与筛选防抖已抽到 `use-unified-filter-sync`(Task 4,守行数红线);
 * props 合同与顶部条件栏/两条浮条的挂点分别抽到 `./StreamViewProps` 与 `./StreamViewBars`。
 */
import { useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { itemPaths } from '../../shared/filter-conditions';
import { noteMruOf } from '../palette/palette-mru';
import { usePaletteSettings } from '../palette/use-palette-settings';
import { UnifiedInput } from '../unified/UnifiedInput';
import { effectFor } from '../unified/unified-accept';
import { useUnifiedFilterSync } from './use-unified-filter-sync';
import { useQuickOpen } from '../palette/use-quick-open';
import { NoteStream } from '../stream/NoteStream';
import { OFF_BATCH } from '../filter/use-batch-selection';
import { OFF_COND_BATCH } from '../filter/use-cond-batch';
import { sortHintLabel } from '../filter/sort-conditions';
import { ErrorBars } from './ErrorBars';
import { TagPreviewCard } from './TagPreviewCard';
import type { ErrorKind } from './ErrorBar';
import { StreamViewBars } from './StreamViewBars';
import type { StreamViewProps } from './StreamViewProps';

/** props 合同搬到了 ./StreamViewProps(守 200 行红线),对外导出路径不变 */
export type { StreamViewProps } from './StreamViewProps';

export function StreamView(p: StreamViewProps): ReactNode {
  const batch = p.batchModes?.notes ?? OFF_BATCH;
  const condBatch = p.batchModes?.conds ?? OFF_COND_BATCH;
  // 统一输入框的模式(query 的防抖写条件在 hook 里):采纳决策与提示行都从这里取
  const { mode, onStateChange } = useUnifiedFilterSync(p.onPatch);
  // props 现读:采纳回调可能在很久以后才跑,不能闭包住旧 props
  const latest = useRef(p);
  latest.current = p;
  // MRU 记账与候选体系同一套设置装配(只在此处标脏,空闲/退出才落盘)
  const { settings, saveMruSoon } = usePaletteSettings();
  // `[[` 补全的笔记 MRU:统一输入框与卡片编辑框共用这一份(同一窗口只能有一个内存实例)
  const noteMru = useMemo(() => noteMruOf(settings, saveMruSoon), [settings, saveMruSoon]);

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

  /** 未解析 chip 点击(设计 §4):把 `@原文` 放进统一输入框并聚焦。
   *  先 setRaw 写全文(盖掉已有草稿),再 prefill('@') 抢焦点 ——
   *  prefill 走 withPrefix(只带前缀 + 当前 query),直接传 `@原文` 会拼成 `@原文原文`。 */
  const prefillNoteSearch = (title: string) => {
    const c = p.unifiedRef.current;
    if (c === null) return;
    c.setRaw(`@${title}`);
    c.prefill('@');
  };

  // `/` 模式的提示行文案:命中数取 query_notes 返回的长度,排序文案跟随条件
  const stat =
    mode === 'filter'
      ? `/ 关键词筛选 · 命中 ${p.notes.length} 条 · ${sortHintLabel(p.conditions.sorts)}`
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
        dataVersion={p.dataVersion ?? 0}
        excludeNoteId={p.editingId ?? undefined}
        noteMru={noteMru}
      />
      <StreamViewBars
        conditions={p.conditions}
        onPatch={p.onPatch}
        addConditionOpen={p.addConditionOpen}
        onAddConditionOpenChange={p.onAddConditionOpenChange}
        dataVersion={p.dataVersion ?? 0}
        batch={batch}
        condBatch={condBatch}
      />
      <ErrorBars errors={p.errors} onRetry={p.onRetry} onDismiss={p.onDismissError} />
      {/* 预览卡片(§5.4):条件栏之后、笔记流之前;不进 notes 数组,不参与分页 / 分组 / 空态 */}
      {p.preview !== null && <TagPreviewCard {...p.preview} />}
      <NoteStream
        notes={p.notes}
        queryFailed={p.queryFailed}
        filterEmpty={p.filterEmpty}
        onRetry={p.onRetry}
        onClearFilters={p.onClearFilters}
        onShowInput={p.onShowInput}
        activeTags={itemPaths(p.conditions, 'tag')}
        editingId={p.editingId}
        hasMore={p.hasMore}
        loading={p.loading}
        grouping={p.grouping}
        notice={p.notice}
        onLoadMore={p.onLoadMore}
        onTagClick={p.onToggleTag}
        onEdit={p.onEdit}
        onSwitchEdit={p.onSwitchEdit}
        onDelete={p.onDelete}
        onEditSaved={p.onEditSaved}
        onEditCancel={p.onEditCancel}
        onToggleTask={p.onToggleTask}
        onLinkError={p.onLinkError}
        onOpenNote={openNote}
        onUnresolvedNote={prefillNoteSearch}
        noteMru={noteMru}
        batch={batch}
      />
    </div>
  );
}

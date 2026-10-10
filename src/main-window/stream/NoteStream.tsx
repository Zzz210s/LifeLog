import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Note } from '../../shared/types';
import { EMPTY_STATE_ACTION, EMPTY_STATE_TEXT, streamEmptyState } from '../shell/empty-stream';
import { BTN_SECONDARY } from '../shell/button-classes';
import { EditPanel, type EditPanelProps } from '../editor/EditPanel';

import { NoteItem } from './NoteItem';
import { GroupLog } from './GroupLog';
import type { GroupedView } from '../data/use-stream-feed';
import { useEditHandoff } from './use-edit-handoff';

export interface NoteStreamProps {
  notes: Note[];
  /** 查询是否处于失败态:空列表据此显示失败文案而非“暂无记录”(即使错误行已被关闭) */
  queryFailed: boolean;
  /** 当前是否没有任何收窄条件(排序不算):用于区分“库为空”与“条件无匹配” */
  filterEmpty: boolean;
  /** 查询失败时的重试入口(重发首页) */
  onRetry: () => void;
  /** “无匹配”空态的入口:清空全部筛选条件 */
  onClearFilters: () => void;
  /** “库为空”空态的入口:唤起输入栏 */
  onShowInput: () => void;
  activeTags: string[];
  editingId: number | null;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onTagClick: (name: string) => void;
  onEdit: (note: Note) => void;
  /** 编辑面板已提交成功后的切换(内容未变也算):不受"编辑中不抢"守卫限制 */
  onSwitchEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onEditSaved: (note: Note) => void;
  onEditCancel: () => void;
  /** 点击正文任务复选框:勾选/取消该笔记第 index 个任务项 */
  onToggleTask: (note: Note, index: number) => void;
  /** 流内链接打开失败上报(交主窗错误机制) */
  onLinkError: (message: string) => void;
  /** 点正文里已解析的笔记链接 chip:跳到那个条目(L2) */
  onOpenNote: (id: number) => void;
  /** 点未解析的 chip:拿原文预填输入框 `@`(L2) */
  onUnresolvedNote: (title: string) => void;
  /** 笔记 MRU(`[[` 候选排序与采纳记账;与主窗共用一份实例) */
  noteMru?: EditPanelProps['noteMru'];
  /** 分组渲染接线(非空 = 分组模式;不传/传 null = 平铺,原行为不变) */
  grouping?: GroupedView | null;
  /** 顶部提示(degraded/slow 文案);null 不渲染 */
  notice?: string | null;
}

/** 时间流:滚动到底自动加载;被编辑条目原位展开为就地源码编辑框 */
export function NoteStream(p: NoteStreamProps): ReactNode {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const handoff = useEditHandoff();

  /** 进编辑:click = 用户点正文(带光标偏移与点击屏幕 y);panel = 编辑面板已提交成功后的切换 */
  const openEdit = (n: Note, via: 'click' | 'panel', caret?: number | null, clickY?: number): void => {
    handoff.begin(scroller, caret, clickY);
    if (via === 'panel') p.onSwitchEdit(n);
    else p.onEdit(n);
  };

  // 编辑中的笔记已不在列表里(被并发删除/筛选自愈):收起编辑态,避免"永远编辑中"卡住
  useEffect(() => {
    if (p.editingId !== null && !p.notes.some((n) => n.id === p.editingId)) p.onEditCancel();
  }, [p.editingId, p.notes, p.onEditCancel]);

  useEffect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && p.hasMore && !p.loading) p.onLoadMore();
      },
      // root 必须指向内层滚动容器:哨兵在该容器内,隐式 root=视口时二者永不相交,rootMargin 也不生效
      { root: scroller, rootMargin: '200px' }
    );
    io.observe(sentinel);
    return () => io.disconnect();
    // 依赖变化时重建观察器:翻页/筛选/加载态翻转后需重新评估哨兵可见性
  }, [sentinel, scroller, p.hasMore, p.loading, p.onLoadMore, p.notes.length]);

  const empty =
    p.notes.length === 0 && !p.loading
      ? streamEmptyState({ noteCount: 0, queryFailed: p.queryFailed, filterEmpty: p.filterEmpty })
      : null;
  const onEmptyAction =
    empty === 'failed' ? p.onRetry : empty === 'no-match' ? p.onClearFilters : p.onShowInput;

  /** 单条渲染(平铺与分组共用):编辑中 -> 就地编辑面板,否则卡片。key 在元素内部给 */
  const renderNote = (n: Note): ReactNode =>
    n.id === p.editingId ? (
      <EditPanel
        key={n.id}
        note={n}
        noteMru={p.noteMru}
        caretHint={handoff.caretHint}
        onSaved={p.onEditSaved}
        onCancel={p.onEditCancel}
        onSwitchNote={(id) => {
          const next = p.notes.find((x) => x.id === id);
          if (next) openEdit(next, 'panel');
          else p.onEditCancel();
        }}
        onErrorFallback={p.onLinkError}
        onMounted={() => {
          handoff.settle(scroller);
          // 取证(2026-10-03):流还跳时,这几个值能直接定位是哪一步没生效。
          // scrollAt800 是关键 —— 浏览器把"光标滚动祖先"带进视野发生在挂载之后,
          // 只看挂载那一刻(nowScroll)会漏掉这次晚到的跳动。
          const w = window as unknown as { __editCaretLog?: Array<Record<string, unknown>> };
          w.__editCaretLog = w.__editCaretLog ?? [];
          const entry = w.__editCaretLog[w.__editCaretLog.length - 1];
          if (entry) {
            entry.nowScroll = scroller?.scrollTop ?? null;
            window.setTimeout(() => {
              entry.scrollAt800 = scroller?.scrollTop ?? null;
            }, 800);
          }
        }}
      />
    ) : (
      <NoteItem
        key={n.id}
        note={n}
        activeTags={p.activeTags}
        onTagClick={p.onTagClick}
        onEdit={(caret, clickY) => openEdit(n, 'click', caret, clickY)}
        onDelete={() => p.onDelete(n)}
        onToggleTask={(index) => p.onToggleTask(n, index)}
        onLinkError={p.onLinkError}
        onOpenNote={p.onOpenNote}
        onUnresolvedNote={p.onUnresolvedNote}
        onCellSaved={p.onEditSaved}
      />
    );

  return (
    <div ref={setScroller} className="scroll-gutter flex-1 overflow-y-auto">
      {empty !== null && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
          <span>{EMPTY_STATE_TEXT[empty]}</span>
          <button
            onClick={onEmptyAction}
            className={BTN_SECONDARY}
          >
            {EMPTY_STATE_ACTION[empty]}
          </button>
        </div>
      )}
      {p.notice != null && (
        <div
          data-testid="stream-notice"
          className="border-b border-border px-4 py-1 text-label text-muted"
        >
          {p.notice}
        </div>
      )}
      {p.grouping != null ? (
        <GroupLog
          groups={p.grouping.groups}
          collapsed={p.grouping.collapsed}
          loadingGroup={p.grouping.loadingGroup}
          onToggle={p.grouping.onToggle}
          onLoadMore={p.grouping.onLoadMore}
          renderNote={renderNote}
        />
      ) : (
        /* 卡片流容器(视觉刷新 V2):卡片之间用 gap-2(8px)分隔,不再逐条画分隔线;
           容器自带 px-4 py-3,与卡片内边距对齐 */
        <ul className="flex flex-col gap-2 px-4 py-3">{p.notes.map(renderNote)}</ul>
      )}
      {p.loading && (
        <div className="py-3 text-center text-xs text-muted">加载中...</div>
      )}
      <div ref={setSentinel} className="h-px" />
    </div>
  );
}

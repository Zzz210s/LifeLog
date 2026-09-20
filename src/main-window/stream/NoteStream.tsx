import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Note } from '../../shared/types';
import { EMPTY_STATE_ACTION, EMPTY_STATE_TEXT, streamEmptyState } from '../shell/empty-stream';
import { EditPanel } from '../editor/EditPanel';
import { NoteItem } from './NoteItem';

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
  onDelete: (note: Note) => void;
  onEditSaved: (note: Note) => void;
  onEditCancel: () => void;
  /** 点击正文任务复选框:勾选/取消该笔记第 index 个任务项 */
  onToggleTask: (note: Note, index: number) => void;
  /** 流内链接打开失败上报(交主窗错误机制) */
  onLinkError: (message: string) => void;
}

/** 时间流:滚动到底自动加载;被编辑条目原位展开为就地源码编辑框 */
export function NoteStream(p: NoteStreamProps): ReactNode {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

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

  return (
    <div ref={setScroller} className="flex-1 overflow-y-auto">
      {empty !== null && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-faint">
          <span>{EMPTY_STATE_TEXT[empty]}</span>
          <button
            onClick={onEmptyAction}
            className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-hover"
          >
            {EMPTY_STATE_ACTION[empty]}
          </button>
        </div>
      )}
      <ul>
        {p.notes.map((n) =>
          n.id === p.editingId ? (
            <EditPanel key={n.id} note={n} onSaved={p.onEditSaved} onCancel={p.onEditCancel} />
          ) : (
            <NoteItem
              key={n.id}
              note={n}
              activeTags={p.activeTags}
              onTagClick={p.onTagClick}
              onEdit={() => p.onEdit(n)}
              onDelete={() => p.onDelete(n)}
              onToggleTask={(index) => p.onToggleTask(n, index)}
              onLinkError={p.onLinkError}
            />
          )
        )}
      </ul>
      {p.loading && (
        <div className="py-3 text-center text-xs text-faint">加载中...</div>
      )}
      <div ref={setSentinel} className="h-px" />
    </div>
  );
}

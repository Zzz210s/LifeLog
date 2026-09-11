import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Note } from '../shared/types';
import { EditPanel } from './EditPanel';
import { NoteItem } from './NoteItem';

export interface NoteStreamProps {
  notes: Note[];
  /** 查询是否处于失败态:空列表据此显示失败文案而非"暂无记录"(即使错误行已被关闭) */
  queryFailed: boolean;
  /** 查询失败时的重试入口(重发首页) */
  onRetry: () => void;
  activeTags: string[];
  editingId: number | null;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onTagClick: (name: string) => void;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onToggleTodo: (note: Note) => void;
  onEditSaved: (note: Note) => void;
  onEditCancel: () => void;
  /** 流内/预览区链接打开失败上报(交主窗错误机制) */
  onLinkError: (message: string) => void;
}

/** 时间流:滚动到底自动加载;被编辑条目原位展开为分屏 */
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

  return (
    <div ref={setScroller} className="flex-1 overflow-y-auto">
      {p.notes.length === 0 && !p.loading && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-gray-400">
          {p.queryFailed ? (
            <>
              <span>加载失败,请检查后重试</span>
              <button
                onClick={p.onRetry}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                重试
              </button>
            </>
          ) : (
            '暂无记录,用快捷窗记点什么吧'
          )}
        </div>
      )}
      <ul>
        {p.notes.map((n) =>
          n.id === p.editingId ? (
            <EditPanel
              key={n.id}
              note={n}
              onSaved={p.onEditSaved}
              onCancel={p.onEditCancel}
              onLinkError={p.onLinkError}
            />
          ) : (
            <NoteItem
              key={n.id}
              note={n}
              activeTags={p.activeTags}
              onTagClick={p.onTagClick}
              onEdit={() => p.onEdit(n)}
              onDelete={() => p.onDelete(n)}
              onToggleTodo={() => p.onToggleTodo(n)}
              onLinkError={p.onLinkError}
            />
          )
        )}
      </ul>
      {p.loading && (
        <div className="py-3 text-center text-xs text-gray-400">加载中...</div>
      )}
      <div ref={setSentinel} className="h-px" />
    </div>
  );
}

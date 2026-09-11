import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Note } from '../shared/types';
import { EditPanel } from './EditPanel';
import { NoteItem } from './NoteItem';

export interface NoteStreamProps {
  notes: Note[];
  /** 非空时错误态优先于空态文案(查询失败不能伪装成"暂无记录") */
  error: string;
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
}

/** 时间流:滚动到底自动加载;被编辑条目原位展开为分屏 */
export function NoteStream(p: NoteStreamProps): ReactNode {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && p.hasMore && !p.loading) p.onLoadMore();
      },
      { rootMargin: '200px' } // 提前 200px 预取,改善滚动手感
    );
    io.observe(sentinel);
    return () => io.disconnect();
    // 依赖变化时重建观察器:翻页/筛选/加载态翻转后需重新评估哨兵可见性
  }, [sentinel, p.hasMore, p.loading, p.onLoadMore, p.notes.length]);

  return (
    <div className="flex-1 overflow-y-auto">
      {p.notes.length === 0 && !p.loading && (
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          {p.error ? '加载失败,请检查后重试' : '暂无记录,用快捷窗记点什么吧'}
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
              onToggleTodo={() => p.onToggleTodo(n)}
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

/**
 * 自建视图单行(侧栏视图分区):徽标、悬停重命名/删除、拖拽排序、点击应用。
 * 重命名是行内编辑(Enter 提交、Esc 取消、失焦提交),标题回 Original 由上层负责落库。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { SavedView } from '../../shared/types';

export interface ViewRowProps {
  view: SavedView;
  /** 当前条件与该视图条件值相等(高亮) */
  active: boolean;
  /** 命中徽标(查不到时为「—」) */
  badge: string;
  onApply: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}

const ROW_CLASS =
  'group/view flex w-full items-center gap-1.5 rounded px-1.5 py-1 pr-2 text-left text-xs transition-colors cursor-grab ';

export function ViewRow(p: ViewRowProps): ReactNode {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p.view.title);

  const commit = () => {
    setEditing(false);
    const t = title.trim();
    if (t !== '' && t !== p.view.title) p.onRename(t);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setTitle(p.view.title);
            setEditing(false);
          }
        }}
        aria-label="视图标题"
        className="my-0.5 h-7 w-full rounded border border-accent px-2 text-xs outline-none"
      />
    );
  }

  return (
    <div
      data-view-id={p.view.id}
      draggable
      onDragStart={p.onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={p.onDrop}
      onClick={p.onApply}
      title={`视图:${p.view.title}(拖拽调整顺序)`}
      className={ROW_CLASS + (p.active ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-accent-soft hover:text-accent-text')}
    >
      <span className="min-w-0 truncate">{p.view.title}</span>
      <span className="ml-auto flex shrink-0 items-center">
        <span className="pl-2 text-xs tabular-nums text-faint">{p.badge}</span>
        <span className="hidden items-center gap-0.5 pl-1 group-hover/view:flex">
          <button
            type="button"
            title="重命名"
            aria-label={`重命名视图 ${p.view.title}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="rounded px-1 text-faint hover:bg-text/10 hover:text-muted"
          >
            改
          </button>
          <button
            type="button"
            title="删除视图"
            aria-label={`删除视图 ${p.view.title}`}
            onClick={(e) => {
              e.stopPropagation();
              p.onDelete();
            }}
            className="rounded px-1 text-faint hover:bg-danger-soft hover:text-danger"
          >
            删
          </button>
        </span>
      </span>
    </div>
  );
}

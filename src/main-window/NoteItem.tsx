import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { renderMarkdown } from '../shared/markdown';
import type { Note } from '../shared/types';
import { MarkdownBody } from './MarkdownBody';
import { tagDisplayName } from './tag-display';

export interface NoteItemProps {
  note: Note;
  activeTags: string[];
  onTagClick: (name: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleTodo: () => void;
  /** 正文内链接打开失败上报(交主窗错误机制) */
  onLinkError?: (message: string) => void;
}

/** 单条笔记:#todo 复选框 + markdown 正文 + 标签 chips + 悬停编辑/删除(不再显示时间,S2) */
export function NoteItem(p: NoteItemProps): ReactNode {
  const { note } = p;
  const isTodo = note.tags.includes('todo');
  const isDone = note.tags.includes('done');
  // chip 行展示全部标签:时间标签已降级为普通标签(D3),不再是需要滤掉的系统元数据
  const chips = note.tags;
  // 正文渲染按内容缓存:流内任一条目变化会重渲整列,避免重复解析 markdown
  const html = useMemo(() => renderMarkdown(note.content), [note.content]);

  return (
    <li className="group border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        {/* 键盘用户聚焦时也显示操作按钮(不只 group-hover) */}
        <div className="ml-auto flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button onClick={p.onEdit} className="text-xs text-faint hover:text-accent-text">
            编辑
          </button>
          <button onClick={p.onDelete} className="text-xs text-faint hover:text-danger">
            删除
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-start gap-2">
        {(isTodo || isDone) && (
          <input
            type="checkbox"
            checked={isDone}
            onChange={p.onToggleTodo}
            aria-label="todo 状态切换"
            className="mt-1 h-4 w-4 shrink-0 accent-accent"
          />
        )}
        <MarkdownBody
          html={html}
          className="md-body min-w-0 flex-1 text-sm text-text"
          onLinkError={p.onLinkError}
        />
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((t) => {
            const active = p.activeTags.includes(t);
            return (
              <button
                key={t}
                onClick={() => p.onTagClick(t)}
                aria-pressed={active}
                title={t}
                className={
                  'rounded px-1.5 py-0.5 text-xs transition-colors ' +
                  (active ? 'bg-accent-soft text-accent-text' : 'bg-tag text-accent-text hover:bg-accent-soft')
                }
              >
                #{tagDisplayName(t)}
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}

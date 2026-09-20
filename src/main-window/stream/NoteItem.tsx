import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { renderMarkdownInteractive } from '../../shared/markdown';
import type { Note } from '../../shared/types';
import { MarkdownBody } from './MarkdownBody';
import { NoteChips } from './NoteChips';

export interface NoteItemProps {
  note: Note;
  activeTags: string[];
  onTagClick: (name: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** 正文内链接打开失败上报(交主窗错误机制) */
  onLinkError?: (message: string) => void;
  /** 点击第 index 个任务列表复选框(0 起,文档顺序) */
  onToggleTask: (index: number) => void;
}

/** 单条笔记:markdown 正文 + 标签 chips + 悬停编辑/删除(不再显示时间,S2;
 *  行内「完成复选框」已随 done/doing 一并删除(S5),完成状态由正文里的 Markdown
 *  任务列表(- [ ] / - [x])表达,读视图里可直接点击勾选) */
export function NoteItem(p: NoteItemProps): ReactNode {
  const { note } = p;
  // chip 行展示全部标签:时间标签已降级为普通标签(D3),不再是需要滤掉的系统元数据;
  // 主题/属性分两排与折叠阈值都在 NoteChips 里(纯函数在 note-chips.ts)
  // 正文渲染按内容缓存:流内任一条目变化会重渲整列,避免重复解析 markdown
  const html = useMemo(() => renderMarkdownInteractive(note.content), [note.content]);

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
      <MarkdownBody
        html={html}
        className="md-body mt-1 min-w-0 text-sm text-text"
        onLinkError={p.onLinkError}
        interactive
        onToggleTask={p.onToggleTask}
      />
      <NoteChips tags={note.tags} activeTags={p.activeTags} onTagClick={p.onTagClick} />
    </li>
  );
}

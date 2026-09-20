import { useMemo } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { renderMarkdownInteractive } from '../../shared/markdown';
import type { Note } from '../../shared/types';
import { shouldEnterEdit } from './body-click';
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

/** 单条笔记:markdown 正文 + 标签 chips + 悬停删除(不再显示时间,S2;
 *  「编辑」可见按钮已删除(2026-09-21):点正文即就地进源码编辑(Typora 式),
 *  键盘可达性由正文上方的 sr-only 按钮保留;行内「完成复选框」已随 done/doing
 *  一并删除(S5),完成状态由正文里的 Markdown 任务列表表达,读视图可直接勾选) */
export function NoteItem(p: NoteItemProps): ReactNode {
  const { note } = p;
  // chip 行展示全部标签:时间标签已降级为普通标签(D3),不再是需要滤掉的系统元数据;
  // 主题/属性分两排与折叠阈值都在 NoteChips 里(纯函数在 note-chips.ts)
  // 正文渲染按内容缓存:流内任一条目变化会重渲整列,避免重复解析 markdown
  const html = useMemo(() => renderMarkdownInteractive(note.content), [note.content]);

  // 点正文任意非交互处进编辑:链接/复选框/按钮由 shouldEnterEdit 守卫,
  // chip 行不在本容器内,天然不触发
  const onBodyClick = (e: MouseEvent<HTMLDivElement>) => {
    if (shouldEnterEdit(e.target, window.getSelection()?.toString() ?? '')) p.onEdit();
  };

  return (
    <li className="group border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        {/* 键盘通道:可见的「编辑」按钮已删,键盘用户 Tab 到它即显形;鼠标用户看不到 */}
        <button
          onClick={p.onEdit}
          className="sr-only focus:not-sr-only focus:text-xs focus:text-accent-text focus:underline"
        >
          编辑
        </button>
        <div className="ml-auto flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button onClick={p.onDelete} className="text-xs text-faint hover:text-danger">
            删除
          </button>
        </div>
      </div>
      <div onClick={onBodyClick} className="cursor-text" title="点击编辑">
        <MarkdownBody
          html={html}
          className="md-body mt-1 min-w-0 text-sm text-text"
          onLinkError={p.onLinkError}
          interactive
          onToggleTask={p.onToggleTask}
        />
      </div>
      <NoteChips tags={note.tags} activeTags={p.activeTags} onTagClick={p.onTagClick} />
    </li>
  );
}

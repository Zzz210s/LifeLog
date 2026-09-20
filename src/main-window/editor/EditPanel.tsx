import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { renderMarkdown } from '../../shared/markdown';
import { composeSource, prepareForSave } from '../../shared/note-source';
import type { Note } from '../../shared/types';
import { tagCountHint, tagCountLabel } from './edit-tag-count';
import { MarkdownBody } from '../stream/MarkdownBody';

export interface EditPanelProps {
  note: Note;
  onSaved: (note: Note) => void;
  onCancel: () => void;
  /** 预览区链接打开失败上报(交主窗错误机制) */
  onLinkError?: (message: string) => void;
}

/** 编辑态分屏(左源码右预览):源 = 正文 + 标签回显为 #tag */
export function EditPanel(p: EditPanelProps): ReactNode {
  // 决策:note.content 是已剥离标签的正文;编辑源码补回 '#标签' 尾缀,
  // 与输入栏捕获语法一致(用户可看/改标签),保存时后端重新剥离归类。
  const [source, setSource] = useState(() => composeSource(p.note.content, p.note.tags));
  const [preview, setPreview] = useState(() => renderMarkdown(source));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | null>(null);
  // 标签数取笔记已保存的标签集合(与 chip 行、保存路径同一份数据):
  // 前端没有与 Rust tags.rs 逐字对齐的解析器,现算源码里的 #标签 会与保存结果不一致,
  // 宁可滞后也不误报;提示只是建议层,不影响保存。
  const tagCount = p.note.tags.length;
  const hint = tagCountHint(tagCount);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onChange = (v: string) => {
    setSource(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPreview(renderMarkdown(v)), 300);
  };

  const save = async () => {
    const text = prepareForSave(source); // 与创建路径共用保存前入口:只裁行尾空白,空内容拒绝
    if (!text || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateNote(p.note.id, text);
      if (updated) p.onSaved(updated);
      else p.onCancel(); // 笔记已被并发删除:静默退出编辑
    } catch (e) {
      setError(String(e)); // 失败留在编辑态
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="border-b border-accent/40 bg-accent-soft/40 px-4 py-3">
      <div className="grid grid-cols-2 gap-2">
        <textarea
          autoFocus
          aria-label="编辑源码"
          value={source}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
          className="h-64 resize-none rounded-md border border-border bg-raised p-2 font-mono text-sm leading-relaxed outline-none focus:border-accent"
        />
        <MarkdownBody
          html={preview}
          className="md-body h-64 overflow-y-auto rounded-md border border-border bg-raised p-2 text-sm text-text"
          onLinkError={p.onLinkError}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted" data-testid="edit-tag-count">
            {tagCountLabel(tagCount)}
            {hint !== null && <span className="ml-2 text-faint">{hint}</span>}
          </span>
          <span className="text-xs text-danger">{error ? '保存失败: ' + error : 'Ctrl+Enter 保存'}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={p.onCancel}
            className="rounded-md border border-border px-3 py-1 text-sm text-muted hover:bg-hover"
          >
            取消
          </button>
          <button
            onClick={() => void save()}
            disabled={!source.trim() || saving}
            className="rounded-md bg-accent px-3 py-1 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </li>
  );
}

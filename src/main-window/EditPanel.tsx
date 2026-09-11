import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import { renderMarkdown } from '../shared/markdown';
import type { Note } from '../shared/types';

export interface EditPanelProps {
  note: Note;
  onSaved: (note: Note) => void;
  onCancel: () => void;
}

/** 编辑态分屏(左源码右预览):源 = 正文 + 标签回显为 #tag */
export function EditPanel(p: EditPanelProps): ReactNode {
  // 决策:note.content 是已剥离标签的正文;编辑源码补回 '#标签' 尾缀,
  // 与快捷窗捕获语法一致(用户可看/改标签),保存时后端重新剥离归类。
  const [source, setSource] = useState(() => {
    const body = p.note.content.trim();
    const tags = p.note.tags.map((t) => '#' + t).join(' ');
    return tags ? (body ? body + ' ' + tags : tags) : body;
  });
  const [preview, setPreview] = useState(() => renderMarkdown(source));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onChange = (v: string) => {
    setSource(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPreview(renderMarkdown(v)), 300);
  };

  const save = async () => {
    const text = source.trim();
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
    <li className="border-b border-blue-200 bg-blue-50/40 px-4 py-3">
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
          className="h-64 resize-none rounded-md border border-gray-300 bg-white p-2 font-mono text-sm leading-relaxed outline-none focus:border-blue-500"
        />
        <div
          className="md-body h-64 overflow-y-auto rounded-md border border-gray-200 bg-white p-2 text-sm text-gray-800"
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-red-500">{error ? '保存失败: ' + error : 'Ctrl+Enter 保存'}</span>
        <div className="flex gap-2">
          <button
            onClick={p.onCancel}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
          >
            取消
          </button>
          <button
            onClick={() => void save()}
            disabled={!source.trim() || saving}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </li>
  );
}

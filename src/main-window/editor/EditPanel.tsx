import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { composeSource, prepareForSave } from '../../shared/note-source';
import type { Note } from '../../shared/types';
import { tagCountHint, tagCountLabel } from './edit-tag-count';
import { editRows } from './textarea-rows';
import { useSourceTagCount } from './use-source-tags';

export interface EditPanelProps {
  note: Note;
  onSaved: (note: Note) => void;
  onCancel: () => void;
}

/** 编辑态:点正文即就地变源码框(形态 A,2026-09-21;分屏实时预览已退场) */
export function EditPanel(p: EditPanelProps): ReactNode {
  // 决策:note.content 是已剥离标签的正文;编辑源码补回 '#标签' 尾缀,
  // 与输入栏捕获语法一致(用户可看/改标签),保存时后端重新剥离归类。
  const [source, setSource] = useState(() => composeSource(p.note.content, p.note.tags));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // 标签数实时化:输入变化后 250ms 防抖调后端命令 parse_note_source(与保存路径同源),
  // 尚未返回/失败时回退已保存标签数(不闪烁成 0);顺序守卫与去抖细节见 use-source-tags.ts。
  // 纯建议层:保存行为与校验完全不受影响。
  const tagCount = useSourceTagCount(source, p.note.tags.length);
  const hint = tagCountHint(tagCount);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // R4:进编辑**不改动笔记流的滚动位置**。原先用 autoFocus,浏览器聚焦时会做 scrollIntoView ——
  // 被视口裁掉的卡片一旦点进编辑,流 scrollTop 就被拉回去(实测 200 -> 0,跳 200px)。
  // 改成显式 focus + preventScroll:焦点照样落在源码框(键盘可达性与 Ctrl+Enter 不变),
  // 但不向任何滚动祖先请求“把焦点元素滚进视野”。
  useEffect(() => {
    boxRef.current?.focus({ preventScroll: true });
  }, []);

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
      <textarea
        ref={boxRef}
        aria-label="编辑源码"
        rows={editRows(source)}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
        className="scroll-gutter w-full resize-y rounded-md border border-border bg-raised p-2 font-mono text-sm leading-relaxed outline-none focus:border-accent"
      />
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

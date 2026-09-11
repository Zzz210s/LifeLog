import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';

/** 顶部常驻输入框:自动增高,Ctrl+Enter 或按钮保存(语法与快捷窗一致) */
export function Composer({ onSaved }: { onSaved: () => void }): ReactNode {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  /** 自动增高:先归零再按内容撑开;超过 280px(约 10 行)转内部滚动 */
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 280) + 'px';
  };

  const save = async () => {
    const text = content.trim();
    if (!text || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.saveQuickNote(text);
      setContent('');
      if (ref.current) ref.current.style.height = 'auto';
      onSaved();
    } catch (e) {
      setError(String(e)); // 失败保留输入
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-gray-200 px-4 py-3">
      <textarea
        ref={ref}
        rows={1}
        aria-label="记点什么"
        value={content}
        placeholder="记点什么... #标签 自动归类 · Ctrl+Enter 保存"
        onChange={(e) => {
          setContent(e.target.value);
          resize();
        }}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
        style={{ maxHeight: 280, overflowY: 'auto' }}
        className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 outline-none focus:border-blue-500"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-red-500">{error ? '保存失败: ' + error : ''}</span>
        <button
          onClick={() => void save()}
          disabled={!content.trim() || saving}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          保存
        </button>
      </div>
    </div>
  );
}

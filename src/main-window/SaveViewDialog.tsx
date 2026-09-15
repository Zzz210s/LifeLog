import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import type { FilterConditions } from '../shared/filter-conditions';
import { summaryOf } from './filter-chips';

export interface SaveViewDialogProps {
  conditions: FilterConditions;
  onClose: () => void;
  /** 保存成功(成功提示由上层闪现「已保存视图」) */
  onSaved: () => void;
}

/** 标题字数上限(与 Rust MAX_TITLE_CHARS 一致,按码点计) */
const MAX_TITLE_CHARS = 40;

/** 保存为视图对话框:标题必填;失败(重名/超限等)在框内显示中文原因,不动本地状态 */
export function SaveViewDialog(p: SaveViewDialogProps): ReactNode {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Esc 关闭(捕获阶段)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        p.onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [p]);

  const summary = summaryOf(p.conditions);

  const save = () => {
    const t = title.trim();
    if (t === '') {
      setError('标题不能为空');
      return;
    }
    if ([...t].length > MAX_TITLE_CHARS) {
      setError(`标题最多 ${MAX_TITLE_CHARS} 字`);
      return;
    }
    setBusy(true);
    void api
      .createView(t, p.conditions)
      .then(() => {
        p.onSaved();
        p.onClose();
      })
      .catch((e) => setError(String(e))) // 后端错误已是中文(如「已有同名视图」)
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div role="dialog" aria-label="保存为视图" className="w-80 rounded-lg border border-border bg-raised p-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-text">保存为视图</h2>
          <button
            type="button"
            onClick={p.onClose}
            aria-label="关闭"
            className="rounded px-1 text-faint hover:bg-hover hover:text-muted"
          >
            ×
          </button>
        </div>
        {summary !== '' && (
          <p className="mb-2 text-xs text-faint" title={summary}>
            将保存当前条件:{summary}
          </p>
        )}
        <input
          autoFocus
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) save();
          }}
          placeholder="视图标题(必填)"
          aria-label="视图标题"
          className="h-8 w-full rounded-md border border-border px-2.5 text-sm outline-none focus:border-accent"
        />
        {error !== '' && <p className="mt-1.5 text-xs text-danger">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={p.onClose}
            className="h-8 rounded-md border border-border px-3 text-xs text-muted hover:border-accent hover:text-accent-text"
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="h-8 rounded-md bg-accent px-3 text-xs text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

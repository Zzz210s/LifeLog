/**
 * 表达式编辑器(spec 3.5):多行输入 + 250ms 防抖走 IPC `validate_expr`,
 * 合法显示绿色中文预览,非法红框 + 「第 N 个字符:<原因>」并把光标移到该处。
 * 表达式只在筛选栏的「添加条件 -> 表达式(高级)」编辑(D4),不进输入栏。
 * 校验状态带 forText:文字改了但结果未回来时视为「校验中」,「确定」一并禁用,
 * 防 250ms 窗口内把非法表达式存下去。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import { ExprSyntaxHint } from './ExprSyntaxHint';
import { caretOf, errorLabelOf, localExprError } from './expr-check';

export interface ExprDialogProps {
  /** 打开时的表达式原文(null = 无表达式) */
  value: string | null;
  /** 关闭不保存(Esc / 取消 / 关闭按钮) */
  onClose: () => void;
  /** 保存(空串 = 清空表达式,由上层归一为 null) */
  onSave: (expr: string) => void;
}

/** 输入到校验的防抖窗口(与筛选栏关键词的 300ms 同量级) */
const DEBOUNCE_MS = 250;

/** 校验状态:forText 记录结果对应哪一版文字,便于识别「校验中」 */
type Check = { forText: string; ok: boolean; message: string; position: number | null };

const BTN =
  'h-8 rounded-md border border-border px-3 text-xs text-muted hover:border-accent hover:text-accent-text';

/** 表达式编辑对话框 */
export function ExprDialog(p: ExprDialogProps): ReactNode {
  const [text, setText] = useState(p.value ?? '');
  const [check, setCheck] = useState<Check>({
    forText: p.value ?? '',
    ok: true,
    message: '',
    position: null,
  });
  const box = useRef<HTMLTextAreaElement>(null);

  // Esc 关闭不保存(捕获阶段,与其它对话框一致)
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

  useEffect(() => {
    const local = localExprError(text);
    if (local !== null) {
      setCheck({ forText: text, ok: false, message: local, position: null });
      return;
    }
    // 全空白视为「没有表达式」:合法、无预览,保存时归一为 null
    if (text.trim() === '') {
      setCheck({ forText: text, ok: true, message: '', position: null });
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      void api
        .validateExpr(text)
        .then((c) => {
          if (stale) return;
          if (c.ok) {
            setCheck({ forText: text, ok: true, message: c.preview, position: null });
            return;
          }
          const at = caretOf(c, text);
          setCheck({ forText: text, ok: false, message: errorLabelOf(c, text), position: at });
          const el = box.current;
          // 只在自己就是焦点时挪光标,避免抢走其它输入的焦点
          if (el !== null && document.activeElement === el) el.setSelectionRange(at, at);
        })
        .catch((e) => {
          if (!stale) setCheck({ forText: text, ok: false, message: '校验失败: ' + String(e), position: null });
        });
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [text]);

  const pending = check.forText !== text;
  const blocked = pending || !check.ok;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="表达式"
        className="w-[30rem] max-w-[90vw] rounded-lg border border-border bg-raised p-4 shadow-xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-medium text-text">表达式(高级)</h2>
          <button
            type="button"
            onClick={p.onClose}
            aria-label="关闭"
            className="rounded px-1 text-faint hover:bg-hover hover:text-muted"
          >
            ×
          </button>
        </div>
        <p className="mb-2 text-xs text-faint">表达式与其它筛选条件同时生效(按与组合)。</p>
        <textarea
          autoFocus
          ref={box}
          aria-label="表达式"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='如:#工作 AND NOT #临时 或 date>=2026-09-01'
          className={
            'w-full resize-y rounded-md border px-2 py-1 font-mono text-sm outline-none ' +
            (check.ok || pending
              ? 'border-border focus:border-accent'
              : 'border-danger bg-danger-soft')
          }
        />
        <p className="mt-1 min-h-4 text-xs" aria-live="polite">
          {pending ? (
            <span className="text-faint">校验中…</span>
          ) : check.ok ? (
            check.message !== '' && <span className="text-success">预览:{check.message}</span>
          ) : (
            <span className="text-danger">{check.message}</span>
          )}
        </p>
        <ExprSyntaxHint onPick={setText} />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            title="清空表达式并保存"
            onClick={() => {
              p.onSave('');
              p.onClose();
            }}
            className={BTN + ' mr-auto'}
          >
            清空
          </button>
          <button type="button" onClick={p.onClose} className={BTN}>
            取消
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => {
              p.onSave(text);
              p.onClose();
            }}
            className="h-8 rounded-md bg-accent px-3 text-xs text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

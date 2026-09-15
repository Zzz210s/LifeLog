import type { ReactNode } from 'react';
import { BTN_GHOST } from './tag-menu-ui';

export interface TagMenuDeletePaneProps {
  /** 目标标签完整路径 */
  path: string;
  /** 影响面读数;null 表示还在计算(确认按钮禁用) */
  impact: { tags: number; notes: number } | null;
  /** 就地错误(空串表示无) */
  error: string;
  /** 请求进行中 */
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 删除面板:影响面读数 + 二次确认(读数未回前不能删) */
export function TagMenuDeletePane(p: TagMenuDeletePaneProps): ReactNode {
  return (
    <div className="p-1">
      <p className="px-1 text-xs text-muted">删除「{p.path}」?</p>
      <p className="mt-1 px-1 text-xs text-faint">
        {p.impact === null
          ? '计算影响面…'
          : `将影响 ${p.impact.notes} 条笔记` +
            (p.impact.tags > 0 ? `、${p.impact.tags} 个子标签` : '')}
      </p>
      {p.error !== '' && <p className="mt-1 px-1 text-xs text-danger">{p.error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={p.onCancel} className={BTN_GHOST}>
          取消
        </button>
        <button
          type="button"
          onClick={p.onConfirm}
          disabled={p.busy || p.impact === null}
          className="h-7 rounded bg-danger px-2 text-xs text-on-danger hover:bg-danger-hover disabled:opacity-50"
        >
          {p.busy ? '删除中…' : '确认删除'}
        </button>
      </div>
    </div>
  );
}

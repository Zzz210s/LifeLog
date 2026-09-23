import type { ReactNode } from 'react';
import { BTN_PRIMARY } from '../shell/button-classes';
import { BTN_GHOST } from './tag-menu-ui';

export interface TagMenuRenamePaneProps {
  /** 受控输入值(上层持状态;改名成功前不落库) */
  newName: string;
  /** 输入变化(上层同时清掉就地错误) */
  onNameChange: (value: string) => void;
  /** 后端或本地校验的中文错误(空串表示无) */
  error: string;
  /** 请求进行中:禁用确定与回车提交 */
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

/** 重命名面板:受控输入 + Enter 提交 + 就地错误 */
export function TagMenuRenamePane(p: TagMenuRenamePaneProps): ReactNode {
  return (
    <div className="p-1">
      <p className="mb-1.5 px-1 text-label text-muted">重命名为</p>
      <input
        autoFocus
        value={p.newName}
        onChange={(e) => p.onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !p.busy) p.onSubmit();
        }}
        aria-label="新标签名"
        className="h-8 w-full rounded-sm border border-border-strong px-2.5 text-ui outline-none"
      />
      {p.error !== '' && <p className="mt-1 px-1 text-label text-danger">{p.error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={p.onCancel} className={BTN_GHOST}>
          取消
        </button>
        <button
          type="button"
          onClick={p.onSubmit}
          disabled={p.busy}
          className={BTN_PRIMARY}
        >
          {p.busy ? '保存中…' : '确定'}
        </button>
      </div>
    </div>
  );
}

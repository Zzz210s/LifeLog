import type { ReactNode } from 'react';
import { dismissLabel } from './errors';

/** 错误来源:查询分页 / 标签计数 / 操作(删除、勾选、编辑保存) */
export type ErrorKind = 'query' | 'tags' | 'action';

export interface AppError {
  kind: ErrorKind;
  message: string;
}

export interface ErrorBarProps {
  error: AppError;
  /** 查询失败时的重试入口(重发首页);其他来源无重试语义 */
  onRetry: () => void;
  onDismiss: () => void;
}

/** 可关闭的错误行:查询失败额外给"重试",瞬时故障无需改筛选即可恢复 */
export function ErrorBar(p: ErrorBarProps): ReactNode {
  return (
    <div className="flex items-center gap-2 border-b border-danger/40 bg-danger-soft px-4 py-1.5 text-xs text-danger">
      <span role="alert" className="min-w-0 flex-1 truncate">
        {p.error.message}
      </span>
      {p.error.kind === 'query' && (
        <button onClick={p.onRetry} className="shrink-0 text-danger hover:text-danger-hover">
          重试
        </button>
      )}
      <button
        onClick={p.onDismiss}
        aria-label={dismissLabel(p.error.kind)}
        className="shrink-0 text-danger hover:text-danger-hover"
      >
        关闭
      </button>
    </div>
  );
}

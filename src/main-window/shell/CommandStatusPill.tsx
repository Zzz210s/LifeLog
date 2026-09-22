/**
 * 命令状态条(主窗右下,设计 D10「Toast 挂主窗右下」):running 常驻,done 自动消失。
 * 只用于"有进行中/有结果"的命令(导出整库 / 重建搜索索引);失败一律走错误条。
 */
import type { ReactNode } from 'react';
import type { CommandStatus } from './use-app-commands';

export function CommandStatusPill({ status }: { status: CommandStatus | null }): ReactNode {
  if (status === null) return null;
  const tone = status.kind === 'done' ? 'border-accent/50 text-accent-text' : 'border-border text-muted';
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="command-status"
      className={`fixed bottom-4 right-4 z-50 rounded-md border bg-raised px-3 py-1.5 text-xs shadow-lg ${tone}`}
    >
      {status.text}
    </div>
  );
}

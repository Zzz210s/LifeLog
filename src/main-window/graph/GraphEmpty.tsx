/**
 * 过滤成空时的提示(G3):画布中央一句中文 + 重置入口(不要让人对着空画布猜)。
 */
import type { ReactNode } from 'react';
import { BTN_SECONDARY } from '../shell/button-classes';

export function GraphEmpty(p: { onReset: () => void }): ReactNode {
  return (
    <div
      data-testid="graph-empty"
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-xs text-muted"
    >
      <div>没有符合过滤条件的标签</div>
      <button
        type="button"
        className={`pointer-events-auto ${BTN_SECONDARY}`}
        onClick={p.onReset}
      >
        重置过滤器
      </button>
    </div>
  );
}

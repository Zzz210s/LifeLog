/**
 * 关系图左上角工具栏(G3):状态文字 + 「过滤器」开关 + 「重置视图」。
 *
 * 「整理布局」按钮在 Task 4 接(现在留位,`busy` 时禁用并显示"整理中…")。
 * 整行不吃指针以外的交互:文字段 `pointer-events-none`(压在画布上也不挡命中),按钮可点。
 */
import type { ReactNode } from 'react';
import { BTN_SECONDARY } from '../shell/button-classes';
import { GraphStatus } from './GraphStatus';

export function GraphToolbar(p: {
  count: string;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onResetView: () => void;
}): ReactNode {
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
      <GraphStatus text={p.count} />
      <button
        type="button"
        className={BTN_SECONDARY}
        aria-expanded={p.filtersOpen}
        onClick={p.onToggleFilters}
      >
        过滤器
      </button>
      <button type="button" className={BTN_SECONDARY} onClick={p.onResetView}>
        重置视图
      </button>
    </div>
  );
}

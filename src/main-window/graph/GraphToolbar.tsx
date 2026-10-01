/**
 * 关系图左上角工具栏(G3):状态文字 + 「过滤器」+ 「整理布局」+ 「重置视图」。
 *
 * 「整理布局」按 G3 设计 §3.4:点一下跑力导向(分块执行),跑动期间按钮禁用并显示"整理中…"。
 * 整行不吃指针以外的交互:状态段 `pointer-events-none`(压在画布上也不挡命中),按钮可点。
 */
import type { ReactNode } from 'react';
import { BTN_SECONDARY } from '../shell/button-classes';
import { GraphStatus } from './GraphStatus';

export function GraphToolbar(p: {
  count: string;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  /** 力导向正在跑:按钮禁用 + 文案换成"整理中…" */
  arranging: boolean;
  onArrange: () => void;
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
      <button type="button" className={BTN_SECONDARY} disabled={p.arranging} onClick={p.onArrange}>
        {p.arranging ? '整理中…' : '整理布局'}
      </button>
      <button type="button" className={BTN_SECONDARY} onClick={p.onResetView}>
        重置视图
      </button>
    </div>
  );
}

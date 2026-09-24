/**
 * 统一输入框的候选下拉(设计 2026-09-24 §4 / 计划 Task 5)。
 *
 * 只做"把候选行画出来 + 把点击/悬停转出去":行**复用浮层的 `PaletteRow`**(`<mark>` 高亮、
 * `data-row-id`、`aria-selected`、`mousedown` 不抢焦点都由它保证),候选本身由
 * `useUnifiedCandidates` 经 `useProviderItems` 从既有 provider 体系取回 —— 本文件不碰
 * 匹配与取数,也不自带键盘(键盘路由在 `UnifiedInput` 的 textarea 上,与浮层口径一致)。
 *
 * 高度:`suggestListHeightCss(COMPLETE_LIMIT)` = 输入栏补全列表的同一上限(8 行);
 * 超出滚动。行数再按 `MAX_ROWS` 兜底截断(渲染保护,不参与计数 —— 计数与截断提示来自列表模型)。
 */
import type { ReactNode } from 'react';
import { COMPLETE_LIMIT } from '../../shared/quickpick/model';
import type { ListRow } from '../../shared/quickpick/model';
import { suggestListHeightCss } from '../../shared/input-geometry';
import { PaletteRow, rowFromListRow } from '../palette/PaletteRow';
import type { PaletteRowData, RowDecoration } from '../palette/PaletteRow';
import type { PaletteController } from '../palette/use-palette';

/** 行渲染上限(防御性:候选源已自带上限,这里只保证 DOM 不被一次画爆) */
export const MAX_RENDER_ROWS = 90;

export interface UnifiedDropdownProps {
  /** 视图行 = 列表模型的 `ListRow` 经 `rowFromListRow(row, decoration)` 投影(含装饰) */
  rows: readonly PaletteRowData[];
  activeIndex: number;
  /** 截断前的命中数(列表模型给;只在截断提示里出现) */
  total: number;
  truncated: boolean;
  onHover: (index: number) => void;
  onAccept: (index: number) => void;
}

export function UnifiedDropdown(p: UnifiedDropdownProps): ReactNode {
  const rows = p.rows.slice(0, MAX_RENDER_ROWS);
  return (
    <div
      data-testid="unified-dropdown"
      role="listbox"
      aria-label="候选列表"
      style={{ maxHeight: suggestListHeightCss(COMPLETE_LIMIT) }}
      className="mt-1 overflow-y-auto rounded-md border border-border bg-raised shadow-lg"
    >
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-ui text-muted">无匹配结果</p>
      ) : (
        <ul>
          {rows.map((row, index) => (
            <PaletteRow
              key={row.id}
              id={`unified-opt-${index}`}
              row={row}
              selected={index === p.activeIndex}
              onHover={() => p.onHover(index)}
              onSelect={() => p.onAccept(index)}
            />
          ))}
        </ul>
      )}
      {p.truncated && (
        <p className="border-t border-border px-3 py-1 text-micro text-muted">
          还有更多,继续输入以缩小范围(命中 {p.total} 项)
        </p>
      )}
    </div>
  );
}

export interface UnifiedDropdownSlotProps {
  /** 列表模型的候选行(经 `rowFromListRow` 补上装饰后交给 `PaletteRow` 渲染) */
  rows: readonly ListRow[];
  total: number;
  truncated: boolean;
  /** 高亮行与悬停都走浮层控制器(循环取模与夹紧在那边):不另建一份选中状态 */
  palette: PaletteController;
  decorations?: Readonly<Record<string, RowDecoration>>;
  onAccept: (index: number) => void;
}

/** 接线槽:把候选数据接到下拉上(自 `UnifiedInput` 抽出以守 200 行红线) */
export function UnifiedDropdownSlot(p: UnifiedDropdownSlotProps): ReactNode {
  return (
    <UnifiedDropdown
      rows={p.rows.map((row) => rowFromListRow(row, p.decorations?.[row.item.id]))}
      activeIndex={p.palette.activeIndex}
      total={p.total}
      truncated={p.truncated}
      onHover={p.palette.setActiveIndex}
      onAccept={p.onAccept}
    />
  );
}

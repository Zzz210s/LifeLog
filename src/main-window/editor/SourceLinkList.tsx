import type { ReactNode } from 'react';
import { COMPLETE_LIMIT } from '../../shared/quickpick/model';
import type { ListRow } from '../../shared/quickpick/model';
import { suggestListHeightCss } from '../../shared/input-geometry';
import { PaletteRow, rowFromListRow } from '../palette/PaletteRow';
import { renderRowCount } from '../palette/palette-limits';

/** 候选 listbox 的 DOM id(源码框的 `aria-controls` 指向它) */
export const EDIT_LINK_LISTBOX_ID = 'edit-link-listbox';

/** 渲染范围内某一行的 DOM id;越界/无行时 `activeEditLinkOptionId` 给 null(不给悬空引用) */
export function editLinkOptionId(index: number): string {
  return `edit-link-opt-${index}`;
}

export function activeEditLinkOptionId(rowCount: number, activeIndex: number): string | null {
  if (activeIndex < 0 || activeIndex >= renderRowCount(rowCount)) return null;
  return editLinkOptionId(activeIndex);
}

export interface SourceLinkListProps {
  /** 未闭合 `[[` 且未被 Esc 收起时为真(否则渲染 null) */
  open: boolean;
  rows: readonly ListRow[];
  activeIndex: number;
  onHover: (index: number) => void;
  onAccept: (index: number) => void;
}

/**
 * 卡片编辑源码框的 `[[` 候选列表(设计 N4):行**复用浮层 `PaletteRow`**(`<mark>` 高亮、
 * `data-row-id`、`mousedown` 不抢焦点都由它保证),打分/截断/命中段来自共享列表模型
 * (`ListRow.ranges`),本文件只做渲染与空态 —— 与统一输入框同一套外观。
 *
 * 与统一输入框那条下拉的区别只在 listbox 的 DOM id:那边是全局固定的 `unified-listbox`,
 * 若两处同时开着会撞 id(顶栏输入框与卡片编辑框可以同屏),故这里自带一份。
 */
export function SourceLinkList(p: SourceLinkListProps): ReactNode {
  if (!p.open) return null;
  const count = renderRowCount(p.rows.length);
  const active = p.activeIndex >= 0 && p.activeIndex < count ? p.activeIndex : -1;
  return (
    <div
      id={EDIT_LINK_LISTBOX_ID}
      data-testid="edit-link-suggest"
      role="listbox"
      aria-label="条目补全候选"
      style={{ maxHeight: suggestListHeightCss(COMPLETE_LIMIT) }}
      className="mt-1 overflow-y-auto rounded-md border border-border bg-raised shadow-lg"
    >
      {count === 0 ? (
        <p role="presentation" className="px-3 py-3 text-ui text-muted">
          没有匹配的条目
        </p>
      ) : (
        <ul role="presentation">
          {p.rows.slice(0, count).map((row, index) => (
            <PaletteRow
              key={row.item.id}
              id={editLinkOptionId(index)}
              row={rowFromListRow(row)}
              selected={index === active}
              onHover={() => p.onHover(index)}
              onSelect={() => p.onAccept(index)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

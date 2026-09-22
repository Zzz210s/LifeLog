/**
 * 浮层单行(设计 §3.1/§3.2):高亮段来自打分器的 positions(纪律 1:UI 不另写 matcher),
 * 右侧副文本放命令快捷键提示 / 标签计数,danger 标危险色,checked 标勾选态。
 * 行不进 Tab 序列:单一 tab stop 在输入框,焦点行由 `aria-activedescendant` 指定。
 */
import type { ReactNode } from 'react';
import type { MatchRange } from '../../shared/fuzzy-score';
import type { ListRow } from '../../shared/quickpick/model';

export interface RowDecoration {
  /** 右侧副文本(命令快捷键提示 / 标签计数) */
  detail?: string;
  danger?: boolean;
  checked?: boolean;
}

export interface PaletteRowData {
  id: string;
  label: string;
  ranges?: readonly MatchRange[];
  detail?: string;
  danger?: boolean;
  checked?: boolean;
}

/** 列表模型行 -> 视图行(T6 只需补装饰,不必重算高亮) */
export function rowFromListRow(row: ListRow, decoration: RowDecoration = {}): PaletteRowData {
  return {
    id: row.item.id,
    label: row.item.label,
    ranges: row.ranges,
    detail: decoration.detail,
    danger: decoration.danger,
    checked: decoration.checked,
  };
}

/** 命中段切片:段间文字原样,命中段包 `<mark>`;无命中即整串文本 */
export function highlightLabel(label: string, ranges: readonly MatchRange[] | undefined): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const range of ranges ?? []) {
    if (range.start > at) parts.push(label.slice(at, range.start));
    parts.push(
      <mark key={range.start} className="rounded-[2px] bg-accent-soft text-accent-text">
        {label.slice(range.start, range.end)}
      </mark>,
    );
    at = range.end;
  }
  if (at < label.length) parts.push(label.slice(at));
  return parts;
}

export interface PaletteRowProps {
  /** DOM id(输入框的 aria-activedescendant 指向它) */
  id: string;
  row: PaletteRowData;
  selected: boolean;
  onHover: () => void;
  onSelect: () => void;
}

export function PaletteRow(p: PaletteRowProps): ReactNode {
  const tone = p.row.danger === true ? 'text-danger' : p.selected ? 'text-accent-text' : 'text-text';
  const cls =
    'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ' +
    `${tone} ${p.selected ? 'bg-accent-soft' : 'hover:bg-hover'}`;
  return (
    <li
      id={p.id}
      role="option"
      aria-selected={p.selected}
      data-row-id={p.row.id}
      onMouseEnter={p.onHover}
      onMouseDown={(e) => e.preventDefault()} // 鼠标不抢输入框焦点(设计 §3.1)
      onClick={p.onSelect}
      className={cls}
    >
      <span className="min-w-0 flex-1 truncate">{highlightLabel(p.row.label, p.row.ranges)}</span>
      {p.row.checked === true && <span className="shrink-0 text-xs text-accent-text">已勾选</span>}
      {p.row.detail !== undefined && p.row.detail !== '' && (
        <span className="shrink-0 text-xs tabular-nums text-faint">{p.row.detail}</span>
      )}
    </li>
  );
}

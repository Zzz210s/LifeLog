/**
 * 表格悬停/选中时的结构控制条(设计 §3):
 *   悬停表格 -> 「+行」「+列」「编辑源码」;某格编辑中(编辑框开着)-> 追加「删除本行」「删除本列」。
 * 位置贴表格边缘:默认压在表格上方一行,上方放不下(表格贴近视口顶)改到表格下方,不遮挡单元格内容;
 * 容器 pointer-events-none,只有按钮吃指针 —— 指针从表格挪到按钮上时靠延时收条兜住这段间隙。
 *
 * 指针落在哪一格:DOM 的 tr.rowIndex / td.cellIndex 现读,与 CellSpan 口径一致(表头 = 行 0);
 * 编辑中的格子优先于指针悬停格。容器带 data-table-controls,供正文点击分流识别(点控件不算点格)。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CellSpan } from '../../shared/md-table';
import { BTN_ICON } from '../shell/button-classes';

export interface TableControlsProps {
  /** 当前悬停/操作的表格元素;为空则整条不渲染 */
  table: HTMLTableElement | null;
  /** 编辑中的格子(编辑框开着);优先于指针悬停格,并决定删除按钮是否出现 */
  cell: CellSpan | null;
  error: string;
  busy: boolean;
  /** at = 数据行下标(0 起),-1 表示插到第一行数据行之前 */
  onAddRow(at: number): void;
  /** at = 列下标(0 起) */
  onAddColumn(at: number): void;
  onRemoveRow(at: number): void;
  onRemoveColumn(at: number): void;
  onEditSource(): void;
}

const HIDE_DELAY_MS = 160;

/**
 * 图标(16 格 / 1.5 描边 / 14px 框,与侧栏 TagsHeader 的图标同一风格)。
 * 语义靠**行/列示意图 + 加减号**区分 —— 单独的加号看不出是加行还是加列(用户 2026-10-03 要求)。
 */
const ROW_ADD = 'M2.5 2.5h11v6.5h-11z M2.5 5.8h11 M8 11v4 M6 13h4';
const COL_ADD = 'M2.5 3.5h6.5v9h-6.5z M2.5 6.8h6.5 M13 8v5 M10.5 10.5h5';
const ROW_DEL = 'M2.5 2.5h11v6.5h-11z M2.5 5.8h11 M6 13h4';
const COL_DEL = 'M2.5 3.5h6.5v9h-6.5z M2.5 6.8h6.5 M10.5 10.5h5';
/** `</>`:看源码,比铅笔更准(铅笔像是"写文章") */
const SOURCE = 'M6 4.5 2.5 8 6 11.5 M10 4.5 13.5 8 10 11.5';

function Icon({ d }: { d: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** 指针落在的格子(表头 = 行 0);不在格上返回 null */
function cellAt(target: EventTarget | null): { row: number; col: number } | null {
  const el = target instanceof Element ? (target.closest('td,th') as HTMLTableCellElement | null) : null;
  if (!el) return null;
  const row = (el.closest('tr') as HTMLTableRowElement | null)?.rowIndex;
  return row === undefined ? null : { row, col: el.cellIndex };
}

export function TableControls(p: TableControlsProps): ReactNode {
  const { table, cell } = p;
  const [hovered, setHovered] = useState(false);
  const [hoverCell, setHoverCell] = useState<{ row: number; col: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const hideTimer = useRef<number | null>(null);

  const show = (): void => {
    if (hideTimer.current !== null) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
    setHovered(true);
  };
  const scheduleHide = (): void => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setHovered(false);
      setHoverCell(null);
      hideTimer.current = null;
    }, HIDE_DELAY_MS);
  };

  // 悬停表:over 冒泡到表上,记下指针所在格;leave 延时收条(留出挪到按钮上的时间)
  useEffect(() => {
    if (!table) { setHovered(false); setHoverCell(null); return; }
    const over = (e: Event): void => { show(); setHoverCell(cellAt(e.target)); };
    table.addEventListener('mouseover', over);
    table.addEventListener('mouseleave', scheduleHide);
    return () => {
      table.removeEventListener('mouseover', over);
      table.removeEventListener('mouseleave', scheduleHide);
    };
  }, [table]);

  // 贴表格边缘:默认上方一行,上方放不下改到下方;resize / 捕获阶段 scroll 都重测
  useLayoutEffect(() => {
    if (!table) { setPos(null); return; }
    const measure = (): void => {
      const r = table.getBoundingClientRect();
      const above = r.top >= 36;
      setPos({ top: above ? r.top - 34 : r.bottom + 4, left: r.left + 2 });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [table]);

  useEffect(() => () => { if (hideTimer.current !== null) window.clearTimeout(hideTimer.current); }, []);

  if (!table || !pos || (!hovered && !cell)) return null;

  // 当前格:编辑中的格子优先;都没有则退回最后一格(指针停在表格留白处)
  const rows = table.rows;
  const dataRows = Math.max(0, rows.length - (table.tHead?.rows.length ?? 1));
  const cols = rows[0]?.cells.length ?? 0;
  const cur = cell ?? hoverCell ?? { row: Math.max(1, dataRows), col: Math.max(0, cols - 1) };

  const action = (d: string, hint: string, onClick: () => void): ReactNode => (
    <button type="button" key={hint} aria-label={hint} title={hint} disabled={p.busy}
      onClick={onClick} className={BTN_ICON}><Icon d={d} /></button>
  );

  return (
    <div
      data-table-controls
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      className="fixed z-40 flex flex-wrap items-center gap-1 rounded-sm border border-border bg-raised p-0.5 pointer-events-none [&_button]:pointer-events-auto"
    >
      {action(ROW_ADD, '在下方插入一行', () => p.onAddRow(cur.row <= 0 ? -1 : cur.row - 1))}
      {action(COL_ADD, '在右侧插入一列', () => p.onAddColumn(cur.col))}
      {cell && cell.row >= 1 && action(ROW_DEL, '删除本行', () => p.onRemoveRow(cell.row - 1))}
      {cell && action(COL_DEL, '删除本列', () => p.onRemoveColumn(cell.col))}
      {action(SOURCE, '编辑源码', p.onEditSource)}
      {p.error !== '' && cell === null && (
        <span role="alert" className="rounded-sm bg-danger-soft px-2 py-1 text-ui text-danger">{p.error}</span>
      )}
    </div>
  );
}

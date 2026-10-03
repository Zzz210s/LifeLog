/**
 * 覆盖式单元格编辑框(设计 §3):定位盖在目标格上,非受控 textarea(DOM 是真源,提交读 value)。
 *
 * 键位:Enter 提交并留在本格 / Tab 提交右移(行尾跳下一行首格)/ Shift+Tab 左移 / Esc 放弃不写库;
 * 输入法组合中(compositionstart..end 之间的 229 键)一律不当作键位。
 *
 * 目标格 DOM 由 anchor(被点的元素)上溯到 <table>,再取 `table.rows[row].cells[col]` —— 表头在
 * thead、数据行在 tbody,HTMLTableElement.rows 按文档序合并,故移动到别的格子时无需重传 anchor。
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { CellSpan } from '../../shared/md-table';
import type { EditStep } from './use-table-edit';

export interface TableCellEditorProps {
  cell: CellSpan | null;
  /** 进入编辑时被点的元素(或它所在的表格);用来按 row/col 定位目标格 */
  anchor: HTMLElement | null;
  error: string;
  busy: boolean;
  onCommit: (text: string, step: EditStep) => void;
  onCancel: () => void;
  /** 外部框 ref(接线层要读未提交内容做结构改写);不传则组件自持一个 */
  boxRef?: RefObject<HTMLTextAreaElement | null>;
  /** 光标落点(源码偏移,按点击位置换算);不传则用浏览器默认(autoFocus 落末尾) */
  caret?: number | null;
}

/** anchor 所在表格里 (row, col) 那格的 DOM;找不到返回 null(退化成左上角零点) */
function cellElement(anchor: HTMLElement | null, row: number, col: number): HTMLElement | null {
  const table = anchor?.closest('table') as HTMLTableElement | null;
  const tr = table?.rows[row];
  return (tr?.cells[col] as HTMLElement | undefined) ?? null;
}

export function TableCellEditor(p: TableCellEditorProps): ReactNode {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = p.boxRef ?? ownRef;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const row = p.cell?.row ?? -1;
  const col = p.cell?.col ?? -1;

  // 贴合目标格:挂载 / 窗格滚动 / 缩放都重测(表格自身是滚动容器,滚动事件用捕获阶段接)
  useLayoutEffect(() => {
    if (row < 0) return;
    const el = cellElement(p.anchor, row, col);
    const measure = (): void => setRect(el ? el.getBoundingClientRect() : null);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [p.anchor, row, col]);

  // 光标跟随点击位置(用户 2026-10-03):autoFocus 默认把光标丢到末尾,这里按点击处的
  // 可见偏移换算成源码偏移后显式设置。框按 `${row}:${col}` 重建,所以每次进格只跑一次。
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || p.caret == null) return;
    const pos = Math.max(0, Math.min(p.caret, box.value.length));
    box.setSelectionRange(pos, pos);
  }, [p.cell, p.caret, boxRef]);

  if (!p.cell) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 组合中的回车/退格不是快捷键
    const value = boxRef.current?.value ?? '';
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); p.onCommit(value, 0); return; }
    if (e.key === 'Tab') { e.preventDefault(); p.onCommit(value, e.shiftKey ? -1 : 1); }
  };

  // 最小宽度 6rem(96px):窄格子也够点;高度贴合行高,内容横向滚动不换行
  return (
    <div
      data-testid="table-cell-editor"
      className="fixed z-50 flex flex-col"
      style={rect ? { top: rect.top, left: rect.left, minWidth: 96 } : undefined}
    >
      <textarea
        key={`${row}:${col}`}
        ref={boxRef}
        aria-label="编辑单元格"
        defaultValue={p.cell.text}
        rows={1}
        autoFocus
        readOnly={p.busy}
        onKeyDown={onKeyDown}
        style={rect ? { width: rect.width, height: rect.height } : undefined}
        className="resize-none overflow-hidden rounded border border-accent bg-raised px-2 py-1 text-xs leading-tight text-text outline-none"
      />
      {p.error !== '' && (
        <div role="alert" className="mt-1 rounded border border-danger bg-danger-soft px-2 py-1 text-xs text-danger">
          {p.error}
        </div>
      )}
    </div>
  );
}

/**
 * 单元格编辑的状态与写库(设计 §3/§4),headless —— 不渲染编辑框。
 *
 * 编辑中只认「格子坐标(row/col)+ 表格 range」,对外派生的 editing span 每次按最新 source 现算:
 * replaceCell 只换一格内容、表结构不变,故坐标跨写库稳定;写库成功后父层换 source,span 自动归位。
 * 非受控 textarea 的 DOM 值是唯一真源 —— 提交时由组件读出 value 传进来(hook 不持有框)。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Note } from '../../shared/types';
import {
  deleteColumn, deleteRow, insertColumn, insertRow,
  replaceCell, tableCells, type CellSpan, type TableRange,
} from '../../shared/md-table';
import { updateNote } from '../data/note-writes';

/** 结构改写纯函数(四者签名一致,供 rewrite 收口) */
type Rewriter = (source: string, range: TableRange, at: number) => string;

/** 提交后移动方向:0 留在本格;+1 右移(行尾折下一行首格);-1 左移(首格折上一行尾) */
export type EditStep = -1 | 0 | 1;

interface Target { range: TableRange; row: number; col: number }

interface Options {
  source: string;
  noteId: number;
  onSaved: (note: Note) => void;
}

export interface TableEdit {
  editing: CellSpan | null;
  anchor: HTMLElement | null;
  error: string;
  busy: boolean;
  openAt(cell: CellSpan, range: TableRange, anchor?: HTMLElement): void;
  commit(text: string, step?: EditStep): Promise<void>;
  cancel(): void;
  /** 在当前行下方加一行(at = 数据行下标,-1 = 插到第一行数据行之前) */
  addRow(range: TableRange, at: number): Promise<void>;
  /** 在当前列右侧加一列(at = 列下标) */
  addColumn(range: TableRange, at: number): Promise<void>;
  /** 删除第 at 行(数据行,0 起) */
  removeRow(range: TableRange, at: number): Promise<void>;
  /** 删除第 at 列(0 起) */
  removeColumn(range: TableRange, at: number): Promise<void>;
}

/** 目标格的相邻格;越出表格(无下一行/上一行)返回 null = 留在本格 */
function stepTo(t: Target, cells: CellSpan[], step: EditStep): Target | null {
  if (step === 0) return t;
  const cols = Math.max(...cells.map((c) => c.col)) + 1;
  const rows = t.range.lines.length - 1; // 表头 + 数据行(分隔行不算)
  let row = t.row;
  let col = t.col + step;
  if (col >= cols) { row += 1; col = 0; }
  else if (col < 0) { row -= 1; col = cols - 1; }
  if (row < 0 || row >= rows) return null;
  return { range: t.range, row, col };
}

export function useTableEdit(opts: Options): TableEdit {
  const { source, noteId, onSaved } = opts;
  const [target, setTarget] = useState<Target | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const editing = useMemo(() => {
    if (!target) return null;
    const cells = tableCells(source, target.range);
    return cells?.find((c) => c.row === target.row && c.col === target.col) ?? null;
  }, [source, target]);

  const openAt = useCallback((cell: CellSpan, range: TableRange, el?: HTMLElement) => {
    setError('');
    setAnchor(el ?? null);
    setTarget({ range, row: cell.row, col: cell.col });
  }, []);

  const cancel = useCallback(() => {
    if (inFlight.current) return; // 已发出写库:等它落地,别把框和错误一起吞掉
    setError('');
    setTarget(null);
  }, []);

  const commit = useCallback(async (text: string, step: EditStep = 0): Promise<void> => {
    if (inFlight.current || !target) return;
    const cells = tableCells(source, target.range);
    const cell = cells?.find((c) => c.row === target.row && c.col === target.col) ?? null;
    if (!cells || !cell) return; // 自校验失败/格子没了:不动
    const move = stepTo(target, cells, step);
    if (text === cell.text) { setTarget(move); return; } // 未变:不写库(与编辑面板同口径),只移动
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const updated = await updateNote(noteId, replaceCell(source, cell, text));
      if (!updated) { setTarget(null); return; } // 笔记已被并发删除:静默收框
      onSaved(updated);
      setTarget(move);
    } catch (e) {
      // 写库失败:就地中文报错并保留框内内容(不改 target,框不卸载、字不丢)
      setError('保存失败: ' + String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [source, target, noteId, onSaved]);

  // 结构改写:一次 updateNote;成功后表结构已变,旧坐标作废 -> 收框。失败不改源码,
  // 就地 setError(框开着由 TableCellEditor 显示,框没开由 TableControls 显示)。
  const rewrite = useCallback(async (
    range: TableRange, at: number, apply: Rewriter,
  ): Promise<void> => {
    if (inFlight.current) return;
    const next = apply(source, range, at);
    if (next === source) return; // 越界 / 删到只剩一列:无变化不写库
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const updated = await updateNote(noteId, next);
      setTarget(null); // 结构变了,收框(坐标不再指向原格)
      if (!updated) return; // 笔记已被并发删除:静默收框
      onSaved(updated);
    } catch (e) {
      setError('保存失败: ' + String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [source, noteId, onSaved]);

  const addRow = useCallback((range: TableRange, at: number) => rewrite(range, at, insertRow), [rewrite]);
  const addColumn = useCallback((range: TableRange, at: number) => rewrite(range, at, insertColumn), [rewrite]);
  const removeRow = useCallback((range: TableRange, at: number) => rewrite(range, at, deleteRow), [rewrite]);
  const removeColumn = useCallback((range: TableRange, at: number) => rewrite(range, at, deleteColumn), [rewrite]);

  return { editing, anchor, error, busy, openAt, commit, cancel, addRow, addColumn, removeRow, removeColumn };
}

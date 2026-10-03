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
  lineSpans, replaceCell, tableCells, type CellSpan, type TableRange,
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
  /** 写库前把改后的正文包装成提交文本(默认原样)。接线层用它补回 #标签 —— 定位/改写只看正文,
   *  否则 composeSource 直接缀在表尾的 `#标签` 行会被 markdown-it 当成表格行,结构改写把它当格子括宽。 */
  wrap?: (body: string) => string;
}

export interface TableEdit {
  editing: CellSpan | null;
  anchor: HTMLElement | null;
  error: string;
  busy: boolean;
  /** 点击位置算出的期望光标偏移(源码偏移);null = 交给浏览器 */
  caretHint: number | null;
  openAt(cell: CellSpan, range: TableRange, anchor?: HTMLElement, caretHint?: number | null): void;
  /** 提交;step = 提交后移动方向;close = true 时提交后收框(点框外走这条) */
  commit(text: string, step?: EditStep, close?: boolean): Promise<void>;
  cancel(): void;
  /** 在当前行下方加一行(at = 数据行下标,-1 = 插到第一行数据行之前);pending 是框里未提交的内容 */
  addRow(range: TableRange, at: number, pending?: string | null): Promise<void>;
  /** 在当前列右侧加一列(at = 列下标);pending 是框里未提交的内容 */
  addColumn(range: TableRange, at: number, pending?: string | null): Promise<void>;
  /** 删除第 at 行(数据行,0 起);pending 是框里未提交的内容 */
  removeRow(range: TableRange, at: number, pending?: string | null): Promise<void>;
  /** 删除第 at 列(0 起);pending 是框里未提交的内容 */
  removeColumn(range: TableRange, at: number, pending?: string | null): Promise<void>;
}

/** 身份包装(不传 wrap 时的默认写库文本) */
const identity = (body: string): string => body;

/** 两个目标是否同一格(用于写库落地时判断用户是否已点开别的格) */
const sameTarget = (a: Target, b: Target): boolean =>
  a.row === b.row && a.col === b.col && a.range.start === b.range.start;

/**
 * 单格替换后重算 range:表起点与行数不变,只有被改那行的文本(及表尾偏移)变了。
 * 供「结构改写前先并入框里未提交内容」用 —— 否则改一半点 +行 会丢字(Task 3 点名的风险)。
 */
function refreshRange(source: string, range: TableRange): TableRange {
  const spans = lineSpans(source);
  const from = spans.findIndex((s) => s.start === range.start);
  if (from < 0) return range;
  const count = range.lines.length;
  const lines: string[] = [];
  for (let l = from; l < from + count && l < spans.length; l++) {
    lines.push(source.slice(spans[l].start, spans[l].end));
  }
  const last = spans[Math.min(from + count, spans.length) - 1];
  return last ? { start: range.start, end: last.end, lines } : range;
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
  const submit = useMemo(() => opts.wrap ?? identity, [opts.wrap]);
  const [target, setTarget] = useState<Target | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** 点击位置算出的期望光标偏移(见 use-in-place-cell 的校正规则) */
  const [caretHint, setCaretHint] = useState<number | null>(null);
  const inFlight = useRef(false);

  const editing = useMemo(() => {
    if (!target) return null;
    const cells = tableCells(source, target.range);
    return cells?.find((c) => c.row === target.row && c.col === target.col) ?? null;
  }, [source, target]);

  const openAt = useCallback((cell: CellSpan, range: TableRange, el?: HTMLElement, hint?: number | null) => {
    setError('');
    setAnchor(el ?? null);
    setCaretHint(hint ?? null);
    setTarget({ range, row: cell.row, col: cell.col });
  }, []);

  const cancel = useCallback(() => {
    if (inFlight.current) return; // 已发出写库:等它落地,别把框和错误一起吞掉
    setError('');
    setTarget(null);
  }, []);

  const commit = useCallback(async (text: string, step: EditStep = 0, close = false): Promise<void> => {
    if (inFlight.current || !target) return;
    const cells = tableCells(source, target.range);
    const cell = cells?.find((c) => c.row === target.row && c.col === target.col) ?? null;
    if (!cells || !cell) return; // 自校验失败/格子没了:不动
    const move = stepTo(target, cells, step);
    // 落地时若用户已点开别的格(target 变了),保留新格,别把它收回/挪走
    const land = (m: Target | null): void => setTarget((prev) => (prev && sameTarget(prev, target) ? m : prev));
    const after = close ? null : move;
    if (text === cell.text) { land(after); return; } // 未变:不写库(与编辑面板同口径),只移动/收框
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const updated = await updateNote(noteId, submit(replaceCell(source, cell, text)));
      if (!updated) { land(null); return; } // 笔记已被并发删除:静默收框
      onSaved(updated);
      land(after);
    } catch (e) {
      // 写库失败:就地中文报错并保留框内内容(不改 target,框不卸载、字不丢)
      setError('保存失败: ' + String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [source, target, noteId, onSaved, submit]);

  // 结构改写:一次 updateNote;成功后表结构已变,旧坐标作废 -> 收框。失败不改源码,
  // 就地 setError(框开着由 TableCellEditor 显示,框没开由 TableControls 显示)。
  const rewrite = useCallback(async (
    range: TableRange, at: number, apply: Rewriter, pending?: string | null,
  ): Promise<void> => {
    if (inFlight.current) return;
    let next = source;
    let r = range;
    // 先把框里未提交的内容并入同一笔写入,再改结构 —— 否则"改一半点 +行"会丢字
    const open = target ? tableCells(next, r)?.find((c) => c.row === target.row && c.col === target.col) ?? null : null;
    if (open && pending != null && pending !== open.text) {
      next = replaceCell(next, open, pending);
      r = refreshRange(next, r);
    }
    next = apply(next, r, at);
    if (next === source) return; // 越界 / 删到只剩一列:无变化不写库
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const updated = await updateNote(noteId, submit(next));
      setTarget(null); // 结构变了,收框(坐标不再指向原格)
      if (!updated) return; // 笔记已被并发删除:静默收框
      onSaved(updated);
    } catch (e) {
      setError('保存失败: ' + String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [source, target, noteId, onSaved, submit]);

  const addRow = useCallback((range: TableRange, at: number, pending?: string | null) => rewrite(range, at, insertRow, pending), [rewrite]);
  const addColumn = useCallback((range: TableRange, at: number, pending?: string | null) => rewrite(range, at, insertColumn, pending), [rewrite]);
  const removeRow = useCallback((range: TableRange, at: number, pending?: string | null) => rewrite(range, at, deleteRow, pending), [rewrite]);
  const removeColumn = useCallback((range: TableRange, at: number, pending?: string | null) => rewrite(range, at, deleteColumn, pending), [rewrite]);

  return { editing, anchor, error, busy, caretHint, openAt, commit, cancel, addRow, addColumn, removeRow, removeColumn };
}

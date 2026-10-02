/**
 * 把卡片正文里的表格点击接到单元格编辑(设计 §1 T1/T2/T7、E4「接线」):
 *   点单元格文字 -> 覆盖编辑框;点 chip / 复选框 / 外链 -> 不接管(既有行为独占);
 *   点表格外正文 -> 整条笔记编辑(由 NoteItem 的 shouldEnterEdit 决定);
 *   表格自校验失败(怪表、围栏里的假表)-> 不接管,同样退化成整条编辑。
 *
 * 目标定位:「正文里第 N 张表 + DOM rowIndex/cellIndex」——与渲染同源,不另写映射。
 * 源码变化后 React 会用 innerHTML 重写正文,旧的表格元素脱离文档;故按序号用 layoutEffect 重找,
 * 编辑框/控制条才有正确锚点(否则写库后框会掉到左上角)。
 *
 * 写库口径:定位与改写只看**正文**(note.content);提交时才用 composeSource 补回 `#标签` ——
 * 否则紧跟在表格后的 `#标签` 行会被 markdown-it 当成表格行,结构改写把它当格子括宽。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import type { Note } from '../../shared/types';
import { composeSource } from '../../shared/note-source';
import { locateTable, tableCells, type TableRange } from '../../shared/md-table';
import { TableCellEditor } from './TableCellEditor';
import { TableControls } from './TableControls';
import { useTableEdit } from './use-table-edit';

/** 点这些元素不进单元格编辑:交给既有行为(开链接/勾任务/跳笔记) */
const INTERACTIVE = 'a,input,button,label,[data-note-link]';

export interface NoteTableEdit {
  /** 挂到 data-note-body 容器上(按序号重找表格元素用) */
  bodyRef: RefObject<HTMLDivElement | null>;
  /** 正文点击分流:返回 true = 已被单元格编辑接管(调用方别再进整条编辑) */
  handleClick(e: MouseEvent<HTMLDivElement>): boolean;
  /** 悬停分流:刷新控制条锚定的表格 */
  handleOver(e: MouseEvent<HTMLDivElement>): void;
  /** 编辑框 + 结构控制条(挂在正文容器之外,点它们不会冒泡成「点正文」) */
  overlay: ReactNode;
}

export function useNoteTableEdit(
  note: Note,
  onSaved: (n: Note) => void,
  onEditSource: () => void,
): NoteTableEdit {
  const source = note.content;
  // 定位/改写吃正文;写库时补回 `#标签`(update_note 是标签整集合替换语义,只发正文会丢标签)
  const wrap = useCallback((body: string) => composeSource(body, note.tags), [note.tags]);
  const edit = useTableEdit({ source, noteId: note.id, onSaved, wrap });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [tableEl, setTableEl] = useState<HTMLTableElement | null>(null);

  const range: TableRange | null = useMemo(
    () => (index === null ? null : locateTable(source, index)),
    [source, index],
  );

  // 源码一变正文就重渲:按序号找回当前表格元素,给编辑框/控制条当锚点
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const el = body && index !== null ? (body.querySelectorAll('table')[index] as HTMLTableElement | undefined) : undefined;
    setTableEl(el ?? null);
  }, [index, source]);

  const indexOf = (body: HTMLElement, table: HTMLTableElement): number =>
    [...body.querySelectorAll('table')].indexOf(table);

  const handleClick = (e: MouseEvent<HTMLDivElement>): boolean => {
    const target = e.target;
    if (!(target instanceof Element)) return false;
    if (target.closest(INTERACTIVE)) return false; // chip / 复选框 / 外链:既有行为独占
    const td = target.closest('td,th');
    const table = td?.closest('table') as HTMLTableElement | null;
    if (!td || !table) return false; // 点表格外正文 -> 交给整条编辑
    const idx = indexOf(e.currentTarget, table);
    const r = idx >= 0 ? locateTable(source, idx) : null;
    const cells = r ? tableCells(source, r) : null;
    if (!r || !cells) return false; // 自校验失败:退化成整条编辑,绝不猜
    const row = (td.closest('tr') as HTMLTableRowElement | null)?.rowIndex ?? -1;
    const col = (td as HTMLTableCellElement).cellIndex;
    const cell = cells.find((c) => c.row === row && c.col === col);
    if (!cell) return false;
    setIndex(idx);
    edit.openAt(cell, r, table);
    return true;
  };

  // 悬停到表格 -> 控制条出现;移到别的表格 -> 换锚点;移到正文其它处 -> 不动
  // (不能清空:鼠标从表格挪到控制条上会先经过正文空白,清空会让控制条中途卸载)
  const handleOver = (e: MouseEvent<HTMLDivElement>): void => {
    const target = e.target;
    const table = target instanceof Element ? (target.closest('table') as HTMLTableElement | null) : null;
    if (!table) return;
    const idx = indexOf(e.currentTarget, table);
    const r = idx >= 0 ? locateTable(source, idx) : null;
    const ok = r !== null && tableCells(source, r) !== null;
    setIndex(ok ? (p) => (p === idx ? p : idx) : null);
  };

  // 点编辑框/控制条之外:先提交框里未提交的内容,避免"改一半点走"丢字
  const latest = useRef(edit);
  latest.current = edit;
  const open = edit.editing !== null;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-testid="table-cell-editor"]') || t.closest('[data-table-controls]')) return;
      const box = boxRef.current;
      if (box) void latest.current.commit(box.value, 0, true); // 提交并收框
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);

  const pending = (): string | null => boxRef.current?.value ?? null;
  const structure = {
    onAddRow: (at: number) => { if (range) void edit.addRow(range, at, pending()); },
    onAddColumn: (at: number) => { if (range) void edit.addColumn(range, at, pending()); },
    onRemoveRow: (at: number) => { if (range) void edit.removeRow(range, at, pending()); },
    onRemoveColumn: (at: number) => { if (range) void edit.removeColumn(range, at, pending()); },
  };

  // 「编辑源码」:先把框里内容落库,再进整条编辑(否则切过去看到的是旧正文)
  const editSource = async (): Promise<void> => {
    const v = pending();
    if (v !== null && edit.editing) await latest.current.commit(v, 0);
    onEditSource();
  };

  const overlay = (
    <>
      <TableCellEditor
        cell={edit.editing}
        anchor={tableEl}
        boxRef={boxRef}
        error={edit.error}
        busy={edit.busy}
        onCommit={edit.commit}
        onCancel={edit.cancel}
      />
      <TableControls
        table={tableEl}
        cell={edit.editing}
        error={edit.error}
        busy={edit.busy}
        {...structure}
        onEditSource={() => void editSource()}
      />
    </>
  );

  return { bodyRef, handleClick, handleOver, overlay };
}

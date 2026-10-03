/**
 * **就地**单元格编辑(用户 2026-10-03 要求大改):
 * 不再往格子上盖一个 textarea,而是把**格子本身**变成可编辑元素。
 *
 * 为什么改:盖 textarea 的方案要自己抢焦点 + 自己算光标位置 —— 实测在真实鼠标下,
 * 第一次点击只把编辑框开出来、拿不到焦点(没有光标),要再点一下才行;CDP 又复现不出来
 * (协议本身会让页面保持激活)。**改用浏览器原生路径**:mousedown 时把该格切成
 * contenteditable 并把内容换成源码,浏览器的「点击落光标」默认行为随后作用在**新内容**上 ——
 * 一次点击即得光标,位置也由浏览器算,不依赖任何自研几何。
 *
 * 生命周期:进入时记下原 innerHTML;退出(提交/取消/卸载)时还原 —— 提交路径上父层会用新正文
 * 重渲整块正文,还原作用在已脱离文档的旧节点上,无害。
 */
import { useEffect } from 'react';
import type { CellSpan } from '../../shared/md-table';
import type { EditStep } from './use-table-edit';

export interface InPlaceCellOptions {
  cell: CellSpan | null;
  /** 表格元素:用它按 row/col 找目标格(表头在 thead、数据行在 tbody,rows 按文档序合并) */
  table: HTMLTableElement | null;
  busy: boolean;
  onCommit: (text: string, step: EditStep, close?: boolean) => void;
  onCancel: () => void;
}

function cellElement(table: HTMLTableElement | null, cell: CellSpan | null): HTMLElement | null {
  if (!table || !cell) return null;
  return (table.rows[cell.row]?.cells[cell.col] as HTMLElement | undefined) ?? null;
}

export function useInPlaceCell(p: InPlaceCellOptions): void {
  const row = p.cell?.row ?? -1;
  const col = p.cell?.col ?? -1;
  const source = p.cell?.text ?? '';
  useEffect(() => {
    const el = cellElement(p.table, p.cell);
    if (!el) return;
    const original = el.innerHTML;
    let done = false;
    const finish = (text: string, step: EditStep, close = false): void => {
      if (done) return;
      done = true;
      p.onCommit(text, step, close);
    };
    const cancel = (): void => {
      if (done) return;
      done = true;
      p.onCancel();
    };
    const read = (): string => el.textContent ?? '';

    // 关键顺序:先切可编辑 + 换成源码,mousedown 的默认行为再落光标(落在新内容上)
    el.setAttribute('contenteditable', 'plaintext-only');
    el.textContent = source;
    el.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing || e.keyCode === 229) return; // 输入法组合中不当作快捷键
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // Enter = 提交并退出编辑(就地编辑下「留在本格」没有意义:写库后正文会用新内容重渲,
        // 格子 DOM 被替换,再保持可编辑会与状态不一致)。要接着改就再点一下。
        e.preventDefault();
        finish(read(), 0, true);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        finish(read(), e.shiftKey ? -1 : 1);
      }
    };
    const onBlur = (): void => finish(read(), 0);

    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      el.innerHTML = original;
    };
    // 只在换格/换表时重建;源码变化由父层重渲处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, col, p.table]);
}

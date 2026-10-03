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
  /** 点击位置换算出的**期望**光标偏移(源码偏移);null = 没量出来,完全交给浏览器 */
  caretHint?: number | null;
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

    /**
     * 光标兜底(用户 2026-10-03 报"真实鼠标点一下没有光标"):
     * 浏览器的「点击落光标」是默认行为,执行时机在事件处理之后;若窗口此刻刚被激活,
     * 这次落点可能被随后的激活/聚焦重置掉(CDP 注入输入不走这条路,所以本机自测一直看不到)。
     * 做法:在默认行为跑完之后读一次真实 selection,记下它在格子里的字符偏移;
     * 下一帧若发现偏移丢了(变成 0 或格子不再持有焦点),就按记录补回来 —— 不自己算几何。
     */
    const offsetInCell = (): number | null => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const node = sel.anchorNode;
      if (!node || !el.contains(node)) return null;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let offset = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n === node) return offset + sel.anchorOffset;
        offset += n.textContent?.length ?? 0;
      }
      return null;
    };
    const restore = (offset: number): void => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let left = offset;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const len = n.textContent?.length ?? 0;
        if (left <= len) {
          const r = document.createRange();
          r.setStart(n, left);
          r.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
          return;
        }
        left -= len;
      }
    };
    const saved: { offset: number | null } = { offset: null };
    const saveTimer = window.setTimeout(() => { saved.offset = offsetInCell(); }, 0);
    const raf = requestAnimationFrame(() => {
      if (done) return;
      el.focus({ preventScroll: true });
      const now = offsetInCell();
      const hint = p.caretHint ?? null;
      /**
       * 校正规则(用户 2026-10-03 报"光标跑到末尾"):
       *   ① 有期望偏移且浏览器落点与它差得多(>1 字符)→ 说明这次点击的落光标没生效
       *      (窗口刚被激活时会被跳过,而 focus() 会把光标丢到末尾)→ 用期望值。
       *   ② 否则保持浏览器的落点(它才是权威,±1 字符是它自己的取整)。
       */
      if (hint !== null && (now === null || Math.abs(now - hint) > 1)) {
        restore(hint);
        return;
      }
      if (now !== null && saved.offset !== null && saved.offset !== 0 && now !== saved.offset) restore(saved.offset);
    });

    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    return () => {
      window.clearTimeout(saveTimer);
      cancelAnimationFrame(raf);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      el.innerHTML = original;
    };
    // 只在换格/换表时重建;源码变化由父层重渲处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, col, p.table]);
}

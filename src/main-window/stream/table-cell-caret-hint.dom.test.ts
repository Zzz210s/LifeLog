// @vitest-environment jsdom
/**
 * 光标校正(用户 2026-10-03 报"光标跑到末尾"):
 *   进入就地编辑时若浏览器没落成光标(focus() 会把光标丢到末尾),按点击位置算出的期望偏移纠正。
 * 这里只钉住"期望值真的被落到选区上"这一环;期望值本身的换算在 caret-at-point.test.ts。
 */
import { act, createElement, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInPlaceCell } from './use-in-place-cell';
import type { CellSpan } from '../../shared/md-table';

vi.mock('../../shared/api', () => ({ api: { updateNote: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CELL: CellSpan = { row: 0, col: 0, start: 0, end: 3, text: '第一第二' };

function Harness({ hint, on }: { hint: number | null; on: boolean }): ReactNode {
  const table = useRef<HTMLTableElement>(null);
  // 两段渲染:先挂表格(ref 才有值),再进编辑 —— 与真实路径一致(点格子时表格已在文档里)
  useInPlaceCell({ cell: on ? CELL : null, table: table.current, busy: false, caretHint: hint, onCommit: () => {}, onCancel: () => {} });
  return createElement('table', { ref: table },
    createElement('tbody', null, createElement('tr', null, createElement('td', null, CELL.text))));
}

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  delete (window as unknown as { __caretLog?: unknown }).__caretLog;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

const cell = (): HTMLTableCellElement => host.querySelector('td') as HTMLTableCellElement;
/** 让 rAF 跑一轮 */
const tick = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
};

describe('就地编辑的光标校正', () => {
  it('浏览器没落成光标时:按期望偏移把光标放上去(不是末尾)', async () => {
    await act(async () => { root?.render(createElement(Harness, { hint: 2, on: false })); });
    await act(async () => { root?.render(createElement(Harness, { hint: 2, on: true })); });
    await tick();
    const sel = window.getSelection();
    expect(sel?.anchorNode?.textContent).toBe(CELL.text);
    expect(sel?.anchorOffset).toBe(2);
    expect(cell().getAttribute('contenteditable')).toBe('plaintext-only');
  });

  it('期望偏移为 0:光标落在开头', async () => {
    await act(async () => { root?.render(createElement(Harness, { hint: 0, on: false })); });
    await act(async () => { root?.render(createElement(Harness, { hint: 0, on: true })); });
    await tick();
    expect(window.getSelection()?.anchorOffset).toBe(0);
  });

  it('期望值与浏览器落点不同时:用期望值(浏览器落点不权威)', async () => {
    await act(async () => { root?.render(createElement(Harness, { hint: 3, on: false })); });
    await act(async () => { root?.render(createElement(Harness, { hint: 3, on: true })); });
    await tick();
    expect(window.getSelection()?.anchorOffset).toBe(3);
  });

  it('诊断日志:记录期望值/浏览器落点/最终落点', async () => {
    await act(async () => { root?.render(createElement(Harness, { hint: 1, on: false })); });
    await act(async () => { root?.render(createElement(Harness, { hint: 1, on: true })); });
    await tick();
    const log = (window as unknown as { __caretLog?: Record<string, unknown>[] }).__caretLog ?? [];
    expect(log.length).toBeGreaterThan(0);
    const last = log[log.length - 1];
    expect(last.hint).toBe(1);
    expect(last.final).toBe(1);
  });

  it('没有期望值(null):不干预,交给浏览器', async () => {
    await act(async () => { root?.render(createElement(Harness, { hint: null, on: false })); });
    await act(async () => { root?.render(createElement(Harness, { hint: null, on: true })); });
    await tick();
    // 不干预:光标位置完全由浏览器决定(jsdom 聚焦 contenteditable 时会落在开头)
    const sel = window.getSelection();
    expect(sel?.anchorNode?.textContent).toBe(CELL.text);
    expect(cell().getAttribute('contenteditable')).toBe('plaintext-only');
  });
});

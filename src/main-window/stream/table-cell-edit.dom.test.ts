// **就地**单元格编辑的用例(用户 2026-10-03 大改后):
//   Enter 提交并留在本格 / Tab 提交右移(行尾跳下一行首格)/ Shift+Tab 左移 /
//   Esc 放弃不写库 / 输入法组合中不提交 / 写库失败就地中文报错。
// 编辑对象是**格子本身**(contenteditable):DOM 的 textContent 是唯一真源,用例直接改它。
// @vitest-environment jsdom
import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { locateTable, tableCells } from '../../shared/md-table';
import { useInPlaceCell } from './use-in-place-cell';
import { useTableEdit } from './use-table-edit';

const { updateNote } = vi.hoisted(() => ({ updateNote: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { updateNote } }));
vi.mock('../data/tags-changed', () => ({ notifyTagsChanged: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 两行数据:第 2 行用来验「Tab 在行尾跳下一行首格」 */
const SRC = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';

const note = (content: string): Note => ({
  id: 7, content, created_at: '2026-10-02 08:00:00', links: [], tags: [],
});

/** 最简宿主:真表格 + 开格按钮 + 就地编辑 hook;source 随 onSaved 更新 */
function Harness({ onSaved, wrap }: { onSaved?: (n: Note) => void; wrap?: (b: string) => string }) {
  const [source, setSource] = useState(SRC);
  const tableRef = useRef<HTMLTableElement>(null);
  const edit = useTableEdit({
    source,
    noteId: 7,
    onSaved: (n) => { setSource(n.content); onSaved?.(n); },
    wrap,
  });
  const open = (row: number, col: number) => () => {
    const range = locateTable(source, 0);
    if (!range) return;
    const cell = tableCells(source, range)?.find((c) => c.row === row && c.col === col);
    if (cell && tableRef.current) edit.openAt(cell, range, tableRef.current);
  };
  const btn = (label: string, row: number, col: number) =>
    createElement('button', { key: label, onClick: open(row, col) }, label);
  useInPlaceCell({
    cell: edit.editing,
    table: tableRef.current,
    busy: edit.busy,
    onCommit: edit.commit,
    onCancel: edit.cancel,
  });
  return createElement('div', null,
    createElement('table', { ref: tableRef },
      createElement('thead', null,
        createElement('tr', null, createElement('th', null, 'a'), createElement('th', null, 'b'))),
      createElement('tbody', null,
        createElement('tr', null, createElement('td', null, '1'), createElement('td', null, '2')),
        createElement('tr', null, createElement('td', null, '3'), createElement('td', null, '4')))),
    btn('open-1-0', 1, 0), btn('open-1-1', 1, 1), btn('open-0-1', 0, 1),
    createElement('button', { key: 'ar', onClick: () => { const r = locateTable(source, 0); if (r) void edit.addRow(r, 0, '9'); } }, 'add-row-pending'),
    edit.error !== '' ? createElement('span', { role: 'alert' }, edit.error) : null,
    createElement('output', { 'data-testid': 'source' }, source));
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** 编辑中的格子(就地编辑:带 contenteditable 的那个 td) */
const cell = (): HTMLTableCellElement => {
  const el = host?.querySelector('td[contenteditable]');
  if (!el) throw new Error('没有正在编辑的格子');
  return el as HTMLTableCellElement;
};
const editing = (): boolean => host?.querySelector('td[contenteditable]') != null;
const cellAt = (row: number, col: number): HTMLTableCellElement =>
  host!.querySelectorAll('tr')[row].cells[col] as HTMLTableCellElement;
const sourceNow = (): string => host?.querySelector('[data-testid="source"]')?.textContent ?? '';

async function mount(onSaved?: (n: Note) => void, wrap?: (b: string) => string): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(createElement(Harness, { onSaved, wrap })); });
}

async function click(label: string): Promise<void> {
  const el = [...(host?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label);
  if (!el) throw new Error('未找到按钮 ' + label);
  await act(async () => { (el as HTMLButtonElement).click(); });
}

/** 直接改格子的文本(DOM 是真源,不需要触发 React state) */
function setValue(v: string): void {
  act(() => { cell().textContent = v; });
}

async function press(key: string, opts: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    cell().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => { updateNote.mockReset(); });

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('就地单元格编辑的键盘口径', () => {
  it('Enter:写库一次并退出编辑', async () => {
    updateNote.mockResolvedValue(note('| a | b |\n| --- | --- |\n| 9 | 2 |\n| 3 | 4 |'));
    await mount();
    await click('open-1-0');
    expect(cell().getAttribute('contenteditable')).toBe('plaintext-only');
    expect(cell().textContent).toBe('1');
    setValue('9');
    await press('Enter');
    expect(updateNote).toHaveBeenCalledWith(7, '| a | b |\n| --- | --- |\n| 9 | 2 |\n| 3 | 4 |');
    expect(sourceNow()).toContain('| 9 | 2 |');
    expect(editing()).toBe(false);
  });

  it('Tab:提交并右移(未改内容不写库)', async () => {
    await mount();
    await click('open-1-0');
    await press('Tab');
    expect(updateNote).not.toHaveBeenCalled();
    expect(editing()).toBe(true);
    expect(cell().textContent).toBe('2');
  });

  it('Tab 在行尾:折到下一行首格', async () => {
    await mount();
    await click('open-1-1');
    await press('Tab');
    expect(editing()).toBe(true);
    expect(cell().textContent).toBe('3');
  });

  it('Shift+Tab:左移', async () => {
    await mount();
    await click('open-1-1');
    await press('Tab', { shiftKey: true });
    expect(editing()).toBe(true);
    expect(cell().textContent).toBe('1');
  });

  it('Esc:放弃不写库、退出编辑、格子恢复原渲染', async () => {
    updateNote.mockResolvedValue(note('不该写'));
    await mount();
    await click('open-1-0');
    setValue('改后');
    await press('Escape');
    expect(updateNote).not.toHaveBeenCalled();
    expect(editing()).toBe(false);
    expect(cellAt(1, 0).textContent).toBe('1');
  });

  it('输入法组合中(229)的 Enter 不提交', async () => {
    await mount();
    await click('open-1-0');
    setValue('中');
    await press('Enter', { keyCode: 229 } as KeyboardEventInit);
    expect(updateNote).not.toHaveBeenCalled();
    expect(editing()).toBe(true);
  });

  it('写库失败:就地中文报错,编辑态保留', async () => {
    updateNote.mockRejectedValue(new Error('boom'));
    await mount();
    await click('open-1-0');
    setValue('9');
    await press('Enter');
    expect(host?.querySelector('[role="alert"]')?.textContent).toContain('保存失败');
  });

  it('结构改写前会先提交未保存内容(不丢字)', async () => {
    updateNote.mockResolvedValue(note('| a | b |\n| --- | --- |\n| 9 | 2 |\n| 3 | 4 |'));
    await mount();
    await click('open-1-0');
    setValue('9');
    await click('add-row-pending');
    expect(updateNote).toHaveBeenCalled();
    expect(sourceNow()).toContain('| 9 | 2 |');
  });
});

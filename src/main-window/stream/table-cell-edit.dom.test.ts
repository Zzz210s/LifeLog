// 覆盖式单元格编辑框的用例(设计 §3/§4):
//   Enter 提交并留在本格 / Tab 提交右移(行尾跳下一行首格)/ Shift+Tab 左移 /
//   Esc 放弃不写库 / 输入法组合中不提交 / 写库失败就地中文报错且保留框内内容。
// 非受控 textarea:DOM 是唯一真源 —— 用例直接改 DOM 值(不派发 input),提交只读 DOM 值。
// @vitest-environment jsdom
import { act, createElement, useState, type MouseEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { locateTable, tableCells } from '../../shared/md-table';
import { TableCellEditor } from './TableCellEditor';
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

/** 最简宿主:真表格(供 anchor 上溯)+ 开格按钮 + 编辑框,hook 的 source 随 onSaved 更新 */
function Harness({ onSaved, wrap }: { onSaved?: (n: Note) => void; wrap?: (b: string) => string }) {
  const [source, setSource] = useState(SRC);
  const edit = useTableEdit({
    source,
    noteId: 7,
    onSaved: (n) => { setSource(n.content); onSaved?.(n); },
    wrap,
  });
  const open = (row: number, col: number) => (e: MouseEvent<HTMLButtonElement>) => {
    const range = locateTable(source, 0);
    if (!range) return;
    const cell = tableCells(source, range)?.find((c) => c.row === row && c.col === col);
    if (cell) edit.openAt(cell, range, e.currentTarget);
  };
  const btn = (label: string, row: number, col: number) =>
    createElement('button', { key: label, onClick: open(row, col) }, label);
  return createElement('div', null,
    createElement('table', null,
      createElement('thead', null,
        createElement('tr', null, createElement('th', null, 'a'), createElement('th', null, 'b'))),
      createElement('tbody', null,
        createElement('tr', null, createElement('td', null, '1'), createElement('td', null, '2')),
        createElement('tr', null, createElement('td', null, '3'), createElement('td', null, '4')))),
    btn('open-1-0', 1, 0), btn('open-1-1', 1, 1), btn('open-0-1', 0, 1),
    createElement('button', { key: 'ar', onClick: () => { const r = locateTable(source, 0); if (r) void edit.addRow(r, 0, '9'); } }, 'add-row-pending'),
    createElement(TableCellEditor, {
      cell: edit.editing, anchor: edit.anchor, error: edit.error, busy: edit.busy,
      onCommit: edit.commit, onCancel: edit.cancel,
    }),
    createElement('output', { 'data-testid': 'source' }, source));
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const box = (): HTMLTextAreaElement => {
  const el = host?.querySelector('textarea');
  if (!el) throw new Error('未找到单元格编辑框');
  return el;
};
const hasBox = (): boolean => host?.querySelector('textarea') != null;
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

/** 只改 DOM 值(非受控框不需要触发 React state) */
function setValue(v: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => { setter?.call(box(), v); });
}

async function press(key: string, opts: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
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

describe('单元格编辑框的键盘口径', () => {
  it('Enter:写库一次并留在本格', async () => {
    updateNote.mockResolvedValue(note('| a | b |\n| --- | --- |\n| 9 | 2 |\n| 3 | 4 |'));
    await mount();
    await click('open-1-0');
    expect(box().value).toBe('1');
    setValue('9');
    await press('Enter');
    expect(updateNote).toHaveBeenCalledWith(7, '| a | b |\n| --- | --- |\n| 9 | 2 |\n| 3 | 4 |');
    expect(hasBox()).toBe(true);
    expect(box().value).toBe('9');
    expect(sourceNow()).toContain('| 9 | 2 |');
  });

  it('Tab:提交并右移一格', async () => {
    updateNote.mockResolvedValue(note('| a | b |\n| --- | --- |\n| 9 | 2 |\n| 3 | 4 |'));
    await mount();
    await click('open-1-0');
    setValue('9');
    await press('Tab');
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(box().value).toBe('2');
  });

  it('Tab 在行尾:跳下一行首格(内容未变则不写库)', async () => {
    await mount();
    await click('open-1-1');
    expect(box().value).toBe('2');
    await press('Tab');
    expect(updateNote).not.toHaveBeenCalled();
    expect(box().value).toBe('3');
  });

  it('Shift+Tab:左移一格', async () => {
    await mount();
    await click('open-1-0');
    await press('Tab', { shiftKey: true });
    expect(box().value).toBe('b');
  });

  it('Esc:关框且不写库', async () => {
    await mount();
    await click('open-1-0');
    setValue('9');
    await press('Escape');
    expect(updateNote).not.toHaveBeenCalled();
    expect(hasBox()).toBe(false);
  });

  it('结构改写先并入框里未提交的内容:改一半点 +行 不丢字(一笔写库)', async () => {
    const next = '| a | b |\n| --- | --- |\n| 9 | 2 |\n|  |  |\n| 3 | 4 |';
    updateNote.mockResolvedValue(note(next));
    await mount();
    await click('open-1-0');
    setValue('9');
    await click('add-row-pending'); // addRow(range, 0, '9')
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith(7, next);
  });

  it('写库文本经 wrap 包装(接线层用它补回 #标签;定位/改写只看正文)', async () => {
    updateNote.mockResolvedValue(note('x'));
    await mount(undefined, (body) => `${body}\n#标记`);
    await click('open-1-0');
    setValue('9');
    await press('Enter');
    expect(updateNote).toHaveBeenCalledWith(7, '| a | b |\n| --- | --- |\n| 9 | 2 |\n| 3 | 4 |\n#标记');
  });

  it('输入法组合中的 Enter 不提交', async () => {
    await mount();
    await click('open-1-0');
    setValue('9');
    await press('Enter', { isComposing: true });
    expect(updateNote).not.toHaveBeenCalled();
    expect(hasBox()).toBe(true);
  });

  it('写库失败:框内内容保留,就地中文报错', async () => {
    updateNote.mockRejectedValue(new Error('数据库忙'));
    await mount();
    await click('open-1-0');
    setValue('9');
    await press('Enter');
    expect(box().value).toBe('9');
    const alert = host?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('保存失败');
    expect(alert?.textContent).toContain('数据库忙');
  });
});

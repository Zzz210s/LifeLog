// 表格结构控制条的用例(设计 §3 T3/T4):
//   悬停出「+行/+列/编辑源码」,选格出「删除本行/本列」(删除只对数据行);
//   四个结构按钮各 = 一次 updateNote;失败就地中文报错且源码不变;「编辑源码」只回调不写库。
// @vitest-environment jsdom
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { locateTable, tableCells } from '../../shared/md-table';
import { TableControls } from './TableControls';
import { useTableEdit } from './use-table-edit';

const { updateNote } = vi.hoisted(() => ({ updateNote: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { updateNote } }));
vi.mock('../data/tags-changed', () => ({ notifyTagsChanged: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
const note = (content: string): Note => ({ id: 7, content, created_at: '2026-10-02 08:00:00', links: [], tags: [] });

function Harness({ onEditSource }: { onEditSource: () => void }): ReactNode {
  const [source, setSource] = useState(SRC);
  const [tableEl, setTableEl] = useState<HTMLTableElement | null>(null);
  const edit = useTableEdit({ source, noteId: 7, onSaved: (n) => setSource(n.content) });
  const range = locateTable(source, 0);
  const open = (row: number, col: number) => (): void => {
    if (!range) return;
    const c = tableCells(source, range)?.find((x) => x.row === row && x.col === col);
    if (c) edit.openAt(c, range);
  };
  return createElement('div', null,
    createElement('table', { ref: setTableEl },
      createElement('thead', null, createElement('tr', null,
        createElement('th', null, 'a'), createElement('th', null, 'b'))),
      createElement('tbody', null,
        createElement('tr', null, createElement('td', null, '1'), createElement('td', null, '2')),
        createElement('tr', null, createElement('td', null, '3'), createElement('td', null, '4')))),
    createElement('button', { key: 'o1', onClick: open(1, 0) }, 'open-1-0'),
    createElement('button', { key: 'o2', onClick: open(1, 1) }, 'open-1-1'),
    createElement('button', { key: 'o3', onClick: open(0, 0) }, 'open-0-0'),
    createElement(TableControls, {
      table: tableEl, cell: edit.editing, error: edit.error, busy: edit.busy,
      onAddRow: (at) => { if (range) void edit.addRow(range, at); },
      onAddColumn: (at) => { if (range) void edit.addColumn(range, at); },
      onRemoveRow: (at) => { if (range) void edit.removeRow(range, at); },
      onRemoveColumn: (at) => { if (range) void edit.removeColumn(range, at); },
      onEditSource,
    }),
    createElement('output', { 'data-testid': 'source' }, source));
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const onEditSource = vi.fn();

const tableEl = (): HTMLTableElement => {
  const t = host?.querySelector('table');
  if (!t) throw new Error('未找到表格');
  return t;
};
const sourceNow = (): string => host?.querySelector('[data-testid="source"]')?.textContent ?? '';
const has = (label: string): boolean => host?.querySelector(`button[aria-label="${label}"]`) != null;

async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(createElement(Harness, { onEditSource })); });
}

async function clickText(text: string): Promise<void> {
  const el = [...(host?.querySelectorAll('button') ?? [])].find((b) => b.textContent === text);
  if (!el) throw new Error('未找到按钮 ' + text);
  await act(async () => { (el as HTMLButtonElement).click(); await Promise.resolve(); });
}

async function clickLabel(label: string): Promise<void> {
  const el = host?.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error('未找到按钮 ' + label);
  await act(async () => {
    (el as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 悬停某格:mouseover 冒泡到表格(组件用原生监听) */
async function hover(row: number, col: number): Promise<void> {
  const el = tableEl().rows[row]?.cells[col];
  await act(async () => { el?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
}

const ADD_ROW = '在下方插入一行';
const ADD_COL = '在右侧插入一列';

beforeEach(() => { updateNote.mockReset(); onEditSource.mockReset(); });

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('表格结构控制条', () => {
  it('未悬停、无选中格:不渲染控制条', async () => {
    await mount();
    expect(host?.querySelector('[data-table-controls]')).toBeNull();
  });

  it('悬停表格:出增行/增列/编辑源码,没有删除按钮', async () => {
    await mount();
    await hover(1, 0);
    expect(has(ADD_ROW)).toBe(true);
    expect(has(ADD_COL)).toBe(true);
    expect(has('编辑源码')).toBe(true);
    expect(has('删除本行')).toBe(false);
    expect(has('删除本列')).toBe(false);
  });

  it('选中数据行某格:出删除本行/删除本列', async () => {
    await mount();
    await clickText('open-1-1');
    expect(has('删除本行')).toBe(true);
    expect(has('删除本列')).toBe(true);
  });

  it('表头格:不出「删除本行」,仍出「删除本列」', async () => {
    await mount();
    await clickText('open-0-0');
    expect(has('删除本行')).toBe(false);
    expect(has('删除本列')).toBe(true);
  });

  it('+行:一次写库,行插在当前行下方、列数不变', async () => {
    const next = '| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |';
    updateNote.mockResolvedValue(note(next));
    await mount();
    await hover(1, 0);
    await clickLabel(ADD_ROW);
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith(7, next);
    expect(sourceNow()).toBe(next);
  });

  it('+列:一次写库,每行列数 +1、分隔行同步', async () => {
    const next = '| a | b |  |\n| --- | --- | --- |\n| 1 | 2 |  |\n| 3 | 4 |  |';
    updateNote.mockResolvedValue(note(next));
    await mount();
    await hover(1, 1);
    await clickLabel(ADD_COL);
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith(7, next);
    expect(sourceNow()).toBe(next);
  });

  it('删除本行:一次写库,只少一行', async () => {
    const next = '| a | b |\n| --- | --- |\n| 3 | 4 |';
    updateNote.mockResolvedValue(note(next));
    await mount();
    await clickText('open-1-0');
    await clickLabel('删除本行');
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith(7, next);
  });

  it('删除本列:一次写库,每行少一列', async () => {
    const next = '| a |\n| --- |\n| 1 |\n| 3 |';
    updateNote.mockResolvedValue(note(next));
    await mount();
    await clickText('open-1-1');
    await clickLabel('删除本列');
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith(7, next);
    expect(sourceNow()).toBe(next);
  });

  it('编辑源码:只回调,不写库', async () => {
    await mount();
    await hover(1, 0);
    await clickLabel('编辑源码');
    expect(onEditSource).toHaveBeenCalledTimes(1);
    expect(updateNote).not.toHaveBeenCalled();
  });

  it('写库失败:就地中文报错且源码不变', async () => {
    updateNote.mockRejectedValue(new Error('数据库忙'));
    await mount();
    await hover(1, 0);
    await clickLabel(ADD_ROW);
    expect(updateNote).toHaveBeenCalledTimes(1);
    const alert = host?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('保存失败');
    expect(alert?.textContent).toContain('数据库忙');
    expect(sourceNow()).toBe(SRC);
  });
});

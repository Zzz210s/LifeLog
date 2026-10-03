// @vitest-environment jsdom
/**
 * 光标跟随点击位置(用户 2026-10-03):
 *   编辑框的 `caret` prop = 源码偏移 → 挂载后光标落在该处,而不是浏览器默认的末尾。
 * 换算本身(可见偏移 → 源码偏移)在 `caret-at-point.test.ts` 里单测;
 * 这里只钉住「prop 真的落到 selectionStart/End」这一环。
 */
import { act, createElement, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableCellEditor } from './TableCellEditor';
import type { CellSpan } from '../../shared/md-table';

vi.mock('../../shared/api', () => ({ api: { updateNote: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CELL: CellSpan = { row: 1, col: 0, start: 0, end: 3, text: '第一第二' };

/** 真表格(供 anchor 上溯到 <table> 定位目标格)+ 可切换 caret 的编辑框 */
function Harness({ caret }: { caret: number | null }): ReactNode {
  const anchor = useRef<HTMLTableElement>(null);
  return createElement('div', null,
    createElement('table', { ref: anchor },
      createElement('tbody', null,
        createElement('tr', null, createElement('td', null, CELL.text)))),
    createElement(TableCellEditor, {
      cell: CELL, anchor: anchor.current, caret, error: '', busy: false,
      onCommit: () => {}, onCancel: () => {},
    }));
}

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

const box = (): HTMLTextAreaElement => {
  const el = host.querySelector('textarea');
  if (!el) throw new Error('未找到编辑框');
  return el;
};

async function render(caret: number | null): Promise<void> {
  await act(async () => { root?.render(createElement(Harness, { caret })); });
}

describe('单元格编辑框的光标落点', () => {
  it('给了 caret:光标落在该偏移(不是末尾)', async () => {
    await render(2);
    expect(box().selectionStart).toBe(2);
    expect(box().selectionEnd).toBe(2);
  });

  it('caret = 0:光标在开头', async () => {
    await render(0);
    expect(box().selectionStart).toBe(0);
  });

  it('caret 越界:收敛到文本长度(不抛)', async () => {
    await render(999);
    expect(box().selectionStart).toBe(box().value.length);
  });

  it('不给 caret(null):保持浏览器默认,不报错', async () => {
    await render(null);
    expect(box().value).toBe(CELL.text);
    expect(box().selectionStart).toBeGreaterThanOrEqual(0);
  });
});

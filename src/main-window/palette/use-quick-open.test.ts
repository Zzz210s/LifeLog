/** 快速打开的接线测试:命中即滚、缺筛选先清再定位、清完仍缺才提示 */
// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import { QUICK_OPEN_CLEARED_TEXT, QUICK_OPEN_MISSING_TEXT } from './quick-open';
import { useQuickOpen } from './use-quick-open';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (id: number): Note => ({ id, content: `n${id}`, created_at: '2026-09-22 10:00:00', tags: [] });

interface Harness {
  open: (id: number) => void;
  setNotes: (rows: Note[]) => void;
  setLoading: (v: boolean) => void;
  errors: string[];
  cleared: number;
  unmount: () => void;
}

function mount(initial: Note[], conditions: FilterConditions = EMPTY_FILTER): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const errors: string[] = [];
  const box: { open: (id: number) => void; setNotes: (r: Note[]) => void; setLoading: (v: boolean) => void } = {
    open: () => {},
    setNotes: () => {},
    setLoading: () => {},
  };
  let cleared = 0;
  act(() =>
    root.render(
      createElement(function Host() {
        const [rows, setRows] = useState(initial);
        const [loading, setLoading] = useState(false);
        box.open = useQuickOpen({
          notes: rows,
          loading,
          conditions,
          clearFilters: () => {
            cleared += 1;
          },
          setError: (_k, m) => errors.push(m),
          root: document,
        });
        box.setNotes = setRows;
        box.setLoading = setLoading;
        return null;
      }),
    ),
  );
  return {
    open: (id) => act(() => box.open(id)),
    setNotes: (rows) => act(() => box.setNotes(rows)),
    setLoading: (v) => act(() => box.setLoading(v)),
    errors,
    get cleared() {
      return cleared;
    },
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** 流里放一条可定位的行(li + data-note-body) */
const renderRow = (id: number): void => {
  const ul = document.createElement('ul');
  const li = document.createElement('li');
  const body = document.createElement('div');
  body.setAttribute('data-note-body', String(id));
  li.appendChild(body);
  ul.appendChild(li);
  document.body.appendChild(ul);
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useQuickOpen:三条落地路径', () => {
  it('在结果里:立即滚动高亮,不给提示', () => {
    renderRow(7);
    const h = mount([note(7)]);
    h.open(7);
    expect(document.querySelector('[data-note-body="7"]')!.closest('li')!.className).toContain('bg-accent-soft');
    expect(h.errors).toEqual([]);
    h.unmount();
  });

  it('不在结果里但有筛选:清筛选 + 中文提示,等新结果落地后定位', () => {
    renderRow(9);
    const filtered: FilterConditions = { ...EMPTY_FILTER, keyword: '牛奶' };
    const h = mount([note(1)], filtered);
    h.open(9);
    expect(h.cleared).toBe(1);
    expect(h.errors).toEqual([QUICK_OPEN_CLEARED_TEXT]);

    h.setNotes([note(1), note(9)]); // 重查结果回来
    expect(document.querySelector('[data-note-body="9"]')!.closest('li')!.className).toContain('bg-accent-soft');
    h.unmount();
  });

  it('清筛选后仍然没有(且不在加载中):提示「不在当前筛选结果中」', () => {
    const filtered: FilterConditions = { ...EMPTY_FILTER, keyword: '牛奶' };
    const h = mount([note(1)], filtered);
    h.open(9);
    h.setNotes([note(1)]);
    expect(h.errors).toEqual([QUICK_OPEN_CLEARED_TEXT, QUICK_OPEN_MISSING_TEXT]);
    h.unmount();
  });

  it('无筛选且不在结果里:只提示,不清筛选', () => {
    const h = mount([note(1)]);
    h.open(9);
    expect(h.cleared).toBe(0);
    expect(h.errors).toEqual([QUICK_OPEN_MISSING_TEXT]);
    h.unmount();
  });

  it('清筛选后加载中:先不下结论', () => {
    const filtered: FilterConditions = { ...EMPTY_FILTER, keyword: '牛奶' };
    const h = mount([note(1)], filtered);
    h.open(9);
    h.setLoading(true);
    h.setNotes([note(1)]);
    expect(h.errors).toEqual([QUICK_OPEN_CLEARED_TEXT]);
    h.setLoading(false);
    h.setNotes([note(1)]);
    expect(h.errors).toEqual([QUICK_OPEN_CLEARED_TEXT, QUICK_OPEN_MISSING_TEXT]);
    h.unmount();
  });
});

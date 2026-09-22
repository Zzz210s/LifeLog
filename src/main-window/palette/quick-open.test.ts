/**
 * 快速打开的落地测试:滚动到流中高亮、不在当前筛选结果时的三分支判定与提示文案。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QUICK_OPEN_MISSING_TEXT,
  locatePlan,
  noteRowElement,
  scrollToNote,
} from './quick-open';

function stream(ids: number[]): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = ids
    .map((id) => `<ul><li><div data-note-body="${id}">笔记 ${id}</div></li></ul>`)
    .join('');
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('quick-open:定位计划', () => {
  it('在结果里 = found;不在但还有筛选 = 先清筛选;不在且无筛选 = missing', () => {
    expect(locatePlan([{ id: 1 }, { id: 2 }], 2, true)).toBe('found');
    expect(locatePlan([{ id: 1 }], 9, false)).toBe('clear-filters');
    expect(locatePlan([{ id: 1 }], 9, true)).toBe('missing');
    expect(locatePlan([], 9, true)).toBe('missing');
  });

  it('提示文案是中文且不空', () => {
    expect(QUICK_OPEN_MISSING_TEXT).toBe('该笔记不在当前筛选结果中');
    expect(QUICK_OPEN_MISSING_TEXT).not.toMatch(/[a-z]/i);
  });
});

describe('quick-open:滚动与高亮', () => {
  it('找到时把所在行滚进视野(block=center)并加高亮类,超时后移除', () => {
    vi.useFakeTimers();
    const root = stream([1, 2]);
    const body = root.querySelector<HTMLElement>('[data-note-body="2"]')!;
    const row = body.closest('li') as HTMLElement;
    const spy = vi.fn();
    row.scrollIntoView = spy;

    expect(scrollToNote(root, 2)).toBe(true);
    expect(spy).toHaveBeenCalledWith({ block: 'center' });
    expect(row.classList.contains('bg-accent-soft')).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(row.classList.contains('bg-accent-soft')).toBe(false);
  });

  it('找不到时返回 false 且不抛(jsdom 里 scrollIntoView 不存在也不能炸)', () => {
    const root = stream([1]);
    const body = root.querySelector<HTMLElement>('[data-note-body="1"]')!;
    const row = body.closest('li') as HTMLElement;
    // 模拟 jsdom:没有 scrollIntoView 实现
    (row as { scrollIntoView?: unknown }).scrollIntoView = undefined;
    expect(scrollToNote(root, 1)).toBe(true);
    expect(scrollToNote(root, 99)).toBe(false);
  });

  it('noteRowElement 取的是行(li)而不是正文容器;找不到给 null', () => {
    const root = stream([3]);
    const row = noteRowElement(root, 3);
    expect(row?.tagName).toBe('LI');
    expect(noteRowElement(root, 4)).toBeNull();
  });
});

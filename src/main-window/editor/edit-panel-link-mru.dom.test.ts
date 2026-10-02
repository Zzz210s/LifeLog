// @vitest-environment jsdom
/** 卡片编辑源码框的 `[[` 补全记同一份笔记 MRU(遗留1):采纳后重打 `[[`,刚采纳的排第一。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteMruSource } from '../../shared/note-mru';
import type { Note } from '../../shared/types';
import { EditPanel } from './EditPanel';

const { updateNote, parseNoteSource, completeNotes } = vi.hoisted(() => ({
  updateNote: vi.fn(),
  parseNoteSource: vi.fn(),
  completeNotes: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { updateNote, parseNoteSource, completeNotes } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeMru = (): NoteMruSource => {
  const counts = new Map<string, number>();
  return {
    entries: () => [...counts.entries()].map(([id, count]) => ({ id, count })),
    touch: (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1),
  };
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  parseNoteSource.mockReset();
  parseNoteSource.mockResolvedValue({ content: '', tags: [] });
  completeNotes.mockReset();
  completeNotes.mockResolvedValue([
    { id: 1, title: '买牛奶' },
    { id: 2, title: '购物清单' },
  ]);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const textarea = (): HTMLTextAreaElement => host.querySelector('textarea') as HTMLTextAreaElement;
const labels = (): string[] =>
  Array.from(host.querySelectorAll('[data-testid="edit-link-suggest"] [role="option"]')).map((li) => li.textContent!.trim());
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};
/** 用原型 setter 打字(非受控框),光标落末尾再派发 input(触发判断读光标) */
const type = async (text: string): Promise<void> => {
  const el = textarea();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};
const key = async (k: string): Promise<void> => {
  await act(async () => {
    textarea().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
  await settle();
};

describe('卡片编辑源码框:笔记 MRU(遗留1)', () => {
  it('空查询按 MRU:采纳「购物清单」后重打 `[[`,它排第一', async () => {
    const note: Note = { id: 7, content: '正文', created_at: '2026-10-02 08:00:00', links: [], tags: [] };
    await act(async () => {
      root.render(createElement(EditPanel, { note, onSaved: () => {}, onCancel: () => {}, noteMru: fakeMru() }));
    });
    await settle();
    await type('正文[[购物');
    await key('Enter');
    expect(textarea().value).toBe('正文[[购物清单]]');
    await type('正文[[');
    expect(labels()).toEqual(['购物清单', '买牛奶']); // 刚采纳的排第一
  });
});

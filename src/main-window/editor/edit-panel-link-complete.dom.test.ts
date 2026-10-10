// @vitest-environment jsdom
/**
 * 卡片就地编辑源码框里 `[[` 补全的组件级证据(设计 N4 的读数 2):
 * 打 `[[` 弹候选 -> Enter 采纳写回非受控框且光标落 `]]` 后 -> Esc 先关下拉、再 Esc 才取消编辑 ->
 * Ctrl+Enter 仍保存(下拉开着也一样)-> 候选排除正在编辑的这条自己 -> IME 组合中不采纳 ->
 * 围栏代码块里不弹 -> 点击候选与 Enter 同路径 -> `]]` 闭合即退出。
 *
 * 只桩数据层(`complete_notes`/`parse_note_source`),触发/候选/键盘/采纳/写回全走真组件。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { EditPanel } from './EditPanel';

const { updateNote, parseNoteSource, completeNotes, listTags } = vi.hoisted(() => ({
  updateNote: vi.fn(),
  parseNoteSource: vi.fn(),
  completeNotes: vi.fn(),
  listTags: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { updateNote, parseNoteSource, completeNotes, listTags , noteLinks: vi.fn(async () => ({ outbound: [], backlinks: [] })) } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (content: string, tags: string[] = ['水果'], id = 7): Note => ({
  id,
  content,
  created_at: '2026-09-21 08:00:00',
  links: [],
  tags,
});

let root: Root;
let host: HTMLDivElement;
let onSaved: ReturnType<typeof vi.fn>;
let onCancel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onSaved = vi.fn();
  onCancel = vi.fn();
  updateNote.mockReset();
  parseNoteSource.mockReset();
  parseNoteSource.mockResolvedValue({ content: '', tags: [] });
  completeNotes.mockReset();
  listTags.mockReset();
  listTags.mockResolvedValue([]);
  completeNotes.mockResolvedValue([
    { id: 1, title: '买牛奶' },
    { id: 2, title: '购物清单' },
  ]);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const textarea = (): HTMLTextAreaElement => {
  const el = host.querySelector('textarea');
  if (!el) throw new Error('未找到 textarea');
  return el;
};
const drop = (): Element | null => host.querySelector('[data-testid="edit-link-suggest"]');
const labels = (): string[] =>
  Array.from(host.querySelectorAll('[data-testid="edit-link-suggest"] [role="option"]')).map(
    (li) => li.textContent!.trim(),
  );

async function mount(n: Note): Promise<void> {
  await act(async () => {
    root.render(createElement(EditPanel, { note: n, onSaved, onCancel }));
  });
}

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

/** 用原型 setter 打字(非受控框),并把光标放在指定位置再派发 input —— 触发判断读光标 */
const type = async (text: string, caret = text.length): Promise<void> => {
  const el = textarea();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};

const key = async (k: string, mod: KeyboardEventInit = {}): Promise<void> => {
  await act(async () => {
    textarea().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mod }));
  });
  await settle();
};

describe('卡片编辑源码框:`[[` 笔记补全', () => {
  it('打 `[[` 弹出笔记候选(标题来自 complete_notes),继续打字收窄', async () => {
    await mount(note('正文'));
    await type('正文[[');
    expect(completeNotes).toHaveBeenCalledTimes(1);
    expect(drop()).not.toBeNull();
    expect(labels()).toEqual(['买牛奶', '购物清单']);

    await type('正文[[买');
    expect(labels()).toEqual(['买牛奶']);
  });

  it('Enter 采纳:写回非受控框为 `[[标题]]`,光标落在 `]]` 之后', async () => {
    await mount(note('正文'));
    await type('正文[[买');
    await key('Enter');
    const el = textarea();
    expect(el.value).toBe('正文[[买牛奶]]');
    expect(el.selectionStart).toBe(9); // 2 + 7
    expect(el.selectionEnd).toBe(9);
    expect(drop()).toBeNull(); // 已闭合,下拉收起
  });

  it('点击候选行与 Enter 同路径', async () => {
    await mount(note('正文'));
    await type('[[购');
    const row = host.querySelector('[data-testid="edit-link-suggest"] [role="option"]');
    expect(row).not.toBeNull();
    await act(async () => {
      (row as HTMLElement).click();
    });
    await settle();
    expect(textarea().value).toBe('[[购物清单]]');
  });

  it('Esc 先关下拉(不动正文、不取消),再 Esc 才取消编辑', async () => {
    await mount(note('正文'));
    await type('正文[[买');
    expect(drop()).not.toBeNull();

    await key('Escape');
    expect(drop()).toBeNull(); // 第一下:只收下拉
    expect(onCancel).not.toHaveBeenCalled();
    expect(textarea().value).toBe('正文[[买');

    await key('Escape');
    expect(onCancel).toHaveBeenCalledTimes(1); // 第二下:取消编辑
  });

  it('下拉开着时 Ctrl+Enter 仍保存(走面板同一条 flush 通道)', async () => {
    updateNote.mockResolvedValue(note('正文[[买牛奶]]', [], 7));
    await mount(note('正文'));
    await type('正文[[买');
    await key('Enter', { ctrlKey: true });
    expect(updateNote).toHaveBeenCalledWith(7, '正文[[买');
    expect(onSaved).toHaveBeenCalled();
  });

  it('候选不含正在编辑的这条自己', async () => {
    completeNotes.mockResolvedValue([
      { id: 7, title: '本条自己' },
      { id: 1, title: '买牛奶' },
    ]);
    await mount(note('正文', ['水果'], 7));
    await type('[[');
    expect(labels()).toEqual(['买牛奶']);
  });

  it('IME 组合中按 Enter 不采纳,组合结束后照常采纳', async () => {
    await mount(note('正文'));
    await type('[[买');
    await key('Enter', { keyCode: 229 });
    expect(drop()).not.toBeNull();
    expect(textarea().value).toBe('[[买');

    await key('Enter');
    expect(textarea().value).toBe('[[买牛奶]]');
  });

  it('围栏代码块里打 `[[` 不弹候选,也不取候选池', async () => {
    await mount(note('正文'));
    await type('```\n[[买');
    expect(drop()).toBeNull();
    expect(completeNotes).not.toHaveBeenCalled();
  });

  it('`]]` 出现即退出补全', async () => {
    await mount(note('正文'));
    await type('[[买牛奶]]');
    expect(drop()).toBeNull();
  });
});

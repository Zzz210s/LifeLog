// @vitest-environment jsdom
/**
 * 编辑态的键盘契约(2026-09-28 用户要求恢复键盘保存):
 * Ctrl/Cmd+Enter = 保存并回到预览态;裸 Enter 仍只是换行(正文要能换行);Esc = 取消;
 * 中文输入法上屏那一下的 Enter(keyCode 229 / isComposing)不算快捷键。
 * 面板上有一行小字提示这个快捷键。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { EditPanel } from './EditPanel';

const { updateNote, parseNoteSource } = vi.hoisted(() => ({
  updateNote: vi.fn(),
  parseNoteSource: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { updateNote, parseNoteSource } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (content: string, tags: string[] = ['水果']): Note => ({
  id: 7,
  content,
  created_at: '2026-09-21 08:00:00',
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
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(n: Note): Promise<void> {
  await act(async () => {
    root.render(createElement(EditPanel, { note: n, onSaved, onCancel }));
  });
}

const textarea = (): HTMLTextAreaElement => {
  const el = host.querySelector('textarea');
  if (!el) throw new Error('未找到 textarea');
  return el;
};

const setValue = (el: HTMLTextAreaElement, v: string): Promise<void> =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const press = (init: KeyboardEventInit): Promise<void> =>
  act(async () => {
    textarea().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });

describe('编辑态键盘:Ctrl+Enter 保存并回到预览态', () => {
  it('有改动:写库 + 交给 onSaved 退出编辑', async () => {
    const n = note('正文');
    updateNote.mockResolvedValue(note('改后的正文', []));
    await mount(n);
    await setValue(textarea(), '改后的正文');
    await press({ key: 'Enter', ctrlKey: true });
    expect(updateNote).toHaveBeenCalledWith(n.id, '改后的正文');
    expect(onSaved).toHaveBeenCalled();
  });

  it('没改动:直接回预览态,不写库', async () => {
    await mount(note('正文'));
    await press({ key: 'Enter', ctrlKey: true });
    expect(updateNote).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('裸 Enter 不是保存快捷键(正文要能换行)', async () => {
    updateNote.mockResolvedValue(note('正文', []));
    await mount(note('正文'));
    await press({ key: 'Enter' });
    expect(updateNote).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('输入法组合中的回车不算快捷键(keyCode 229:中文上屏那一下)', async () => {
    updateNote.mockResolvedValue(note('正文', []));
    await mount(note('正文'));
    await press({ key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(updateNote).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('面板上有一行 Ctrl+Enter 的小字提示', async () => {
    await mount(note('正文'));
    const hint = host.querySelector('[data-testid="edit-save-hint"]');
    expect(hint?.textContent).toContain('Ctrl+Enter');
  });
});

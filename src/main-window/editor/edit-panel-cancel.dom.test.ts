// @vitest-environment jsdom
/**
 * Esc = 取消**真的不写库**(2026-10-01 修)。
 *
 * 背景:`EditPanel` 里 `cancelled` 这个 ref 是给卸载兜底用的("主动取消 → 卸载时不要保存"),
 * 但它此前**从未被置真** —— 于是 Esc 取消后面板卸载,兜底把已取消的改动写进了库。
 * 真机复现过:`panel open after Esc = false` 且库里出现了被取消的那段文本。
 *
 * 本文件钉住两件事:
 *   1) Esc 取消 → 卸载兜底不写库;
 *   2) 其它离开方式(点区块外等)的保存行为不受影响 —— 用「改过内容 + 卸载」仍写库做正对照。
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
vi.mock('../../shared/api', () => ({ api: { updateNote, parseNoteSource , noteLinks: vi.fn(async () => ({ outbound: [], backlinks: [] })) } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (content: string): Note => ({
  id: 7,
  content,
  created_at: '2026-10-01 08:00:00',
  links: [],
  tags: ['水果'],
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

const pressEsc = (): Promise<void> =>
  act(async () => {
    textarea().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  });

/** 面板被父层卸载(退出编辑态):这是卸载兜底真正跑起来的时刻 */
async function unmountPanel(): Promise<void> {
  await act(async () => {
    root.render(createElement('div'));
  });
  await act(async () => {}); // 冲掉兜底里的微任务
}

describe('Esc 取消不写库', () => {
  it('改过内容后按 Esc:交给 onCancel,卸载兜底不写库', async () => {
    updateNote.mockResolvedValue(note('不该被保存的内容'));
    await mount(note('原始正文'));
    await setValue(textarea(), '不该被保存的内容');
    await pressEsc();
    expect(onCancel).toHaveBeenCalled();
    await unmountPanel();
    expect(updateNote).not.toHaveBeenCalled();
  });

  it('正对照:没按 Esc 就卸载(点区块外的路径),已改内容仍会被兜底写库', async () => {
    updateNote.mockResolvedValue(note('该被保存的内容'));
    await mount(note('原始正文'));
    await setValue(textarea(), '该被保存的内容');
    await unmountPanel();
    expect(updateNote).toHaveBeenCalledWith(7, '该被保存的内容');
  });

  it('Esc 后再改也不写库:取消标记不会因为后续输入被清掉', async () => {
    updateNote.mockResolvedValue(note('x'));
    await mount(note('原始正文'));
    await setValue(textarea(), '第一版');
    await pressEsc();
    await setValue(textarea(), '第二版');
    await unmountPanel();
    expect(updateNote).not.toHaveBeenCalled();
  });
});

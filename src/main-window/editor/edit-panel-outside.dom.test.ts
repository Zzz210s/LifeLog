// @vitest-environment jsdom
/**
 * 「点编辑区块内 = 继续编辑 / 点区块外 = 保存」的判定证据(jsdom 真渲染 EditPanel):
 * 未变不写库、空内容留在编辑态 + 中文错误、保存失败留在编辑态、点另一条正文先存后进、
 * 面板内一律不触发保存、Esc = 取消。
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
/** 区块外的普通目标(不是笔记正文):点它 = 保存后退出编辑 */
let blank: HTMLDivElement;
/** 区块外的另一条笔记正文:点它 = 先存后进 */
let otherBody: HTMLDivElement;
let onSaved: ReturnType<typeof vi.fn>;
let onCancel: ReturnType<typeof vi.fn>;
let onSwitchNote: ReturnType<typeof vi.fn>;
let onErrorFallback: ReturnType<typeof vi.fn>;

const mount = async (n: Note): Promise<void> => {
  await act(async () => {
    root.render(
      createElement(EditPanel, {
        note: n,
        onSaved,
        onCancel,
        onSwitchNote,
        onErrorFallback,
      })
    );
  });
};

const textarea = (): HTMLTextAreaElement => host.querySelector('textarea') as HTMLTextAreaElement;

const setValue = (v: string): Promise<void> =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea(), v);
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
  });

/** 在区块外派发 pointerdown(探针与真实鼠标都先发 pointerdown) */
const downOutside = (el: Element = blank): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const pressEsc = (): Promise<void> =>
  act(async () => {
    textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  updateNote.mockReset();
  parseNoteSource.mockReset();
  parseNoteSource.mockResolvedValue({ content: '', tags: [] });
  onSaved = vi.fn();
  onCancel = vi.fn();
  onSwitchNote = vi.fn();
  onErrorFallback = vi.fn();
  host = document.createElement('div');
  blank = document.createElement('div');
  otherBody = document.createElement('div');
  otherBody.setAttribute('data-note-body', '9');
  document.body.append(host, blank, otherBody);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  blank.remove();
  otherBody.remove();
});

describe('点编辑区块内 = 继续编辑', () => {
  it('区块内点击不触发保存、不退出编辑', async () => {
    await mount(note('正文'));
    await act(async () => {
      textarea().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(updateNote).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSwitchNote).not.toHaveBeenCalled();
  });
});

describe('点区块外 = 保存(默认口径)', () => {
  it('内容未变:直接退出编辑,不写库(no-op)', async () => {
    await mount(note('正文'));
    await downOutside();
    expect(updateNote).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('内容已改:写库并回调 onSaved(不由面板负责退出编辑)', async () => {
    const updated = note('改后的正文', []);
    updateNote.mockResolvedValue(updated);
    await mount(note('正文'));
    await setValue('改后的正文   ');
    await downOutside();
    expect(updateNote).toHaveBeenCalledWith(7, '改后的正文');
    expect(onSaved).toHaveBeenCalledWith(updated);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSwitchNote).not.toHaveBeenCalled();
  });

  it('内容为空:留在编辑态 + 面板内中文错误,文本不丢', async () => {
    await mount(note('正文'));
    await setValue('   ');
    await downOutside();
    expect(updateNote).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(host.textContent).toContain('内容不能为空');
    expect(textarea().value).toBe('   ');
  });

  it('保存失败:留在编辑态 + 中文错误,不退出、不切走', async () => {
    updateNote.mockRejectedValue(new Error('IPC 失败'));
    await mount(note('正文'));
    await setValue('改后的正文');
    await downOutside();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSwitchNote).not.toHaveBeenCalled();
    expect(host.textContent).toContain('保存失败: Error: IPC 失败');
    expect(textarea().value).toBe('改后的正文');
    expect(onErrorFallback).not.toHaveBeenCalled(); // 面板还在:就地显示,不打扰主窗错误条
  });

  it('点另一条笔记正文:先保存当前(成功)再切过去', async () => {
    updateNote.mockResolvedValue(note('改后的正文', []));
    await mount(note('正文'));
    await setValue('改后的正文');
    await downOutside(otherBody);
    expect(updateNote).toHaveBeenCalledWith(7, '改后的正文');
    expect(onSwitchNote).toHaveBeenCalledWith(9);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('点另一条笔记正文但内容未变:不写库也切过去', async () => {
    await mount(note('正文'));
    await downOutside(otherBody);
    expect(updateNote).not.toHaveBeenCalled();
    expect(onSwitchNote).toHaveBeenCalledWith(9);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('点在链接/复选框上:不算"另一条正文",仍按区块外保存处理', async () => {
    const link = document.createElement('a');
    link.href = '#';
    otherBody.appendChild(link);
    await mount(note('正文'));
    await downOutside(link);
    expect(onSwitchNote).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1); // 未变:直接退出编辑
    expect(updateNote).not.toHaveBeenCalled();
  });
});

describe('Esc = 取消(与取消按钮同义)', () => {
  it('Esc 直接退出编辑,不写库', async () => {
    await mount(note('正文'));
    await setValue('改后的正文');
    await pressEsc();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(updateNote).not.toHaveBeenCalled();
  });
});

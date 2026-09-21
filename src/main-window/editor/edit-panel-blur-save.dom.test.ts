// 「点到程序窗口之外也保存」的用例(用户本轮要求):
//   ① window blur -> 走保存;内容未变则不写库并退出编辑
//   ② blur 时保存失败 -> 交主窗错误条(此时面板通常已随失焦/隐藏卸载)
//   ③ blur 不切换笔记(没有点击目标)
//   ④ 组件卸载后监听必须摘掉(不留泄漏)
// @vitest-environment jsdom
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

// 宿主窗口失焦通道:mock 成可手动触发的订阅(Rust 侧 emit 的等价物)
const tauriListeners: Array<{ event: string; handler: () => void }> = [];
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: () => void) => {
    tauriListeners.push({ event, handler });
    return Promise.resolve(() => {
      const i = tauriListeners.findIndex((l) => l.handler === handler);
      if (i >= 0) tauriListeners.splice(i, 1);
    });
  },
}));

/** 触发 Rust 侧的主窗失焦事件 */
const emitHostBlur = async (): Promise<void> => {
  const subs = tauriListeners.filter((l) => l.event === 'main-window-blur');
  expect(subs.length).toBeGreaterThan(0); // 没有订阅就说明通道没接上
  await act(async () => {
    subs.forEach((l) => l.handler());
    await Promise.resolve();
    await Promise.resolve();
  });
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (content: string): Note => ({
  id: 7,
  content,
  created_at: '2026-09-21 08:00:00',
  tags: ['水果'],
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(extra: Record<string, unknown>): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(EditPanel, { note: note('原始正文'), onSaved: vi.fn(), onCancel: vi.fn(), ...extra })
    );
  });
}

async function type(text: string): Promise<void> {
  const ta = host?.querySelector('textarea');
  if (!ta) throw new Error('找不到文本域');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(ta, ta.value + text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const blurWindow = async (): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new Event('blur'));
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  updateNote.mockReset();
  parseNoteSource.mockResolvedValue({ content: '', tags: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('点到程序窗口之外也保存', () => {
  it('内容已改 + window blur -> 真的写库', async () => {
    updateNote.mockResolvedValue(note('原始正文改了'));
    const onSaved = vi.fn();
    await mount({ onSaved });
    await type('改了');
    await blurWindow();
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('内容未变 + window blur -> 不写库、退出编辑', async () => {
    const onCancel = vi.fn();
    await mount({ onCancel });
    await blurWindow();
    expect(updateNote).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('blur 时保存失败 -> 交主窗错误条(不静默)', async () => {
    const onErrorFallback = vi.fn();
    const pending: Array<(e: Error) => void> = [];
    updateNote.mockImplementation(() => new Promise((_res, rej) => { pending.push(rej); }));
    await mount({ onErrorFallback });
    await type('改了');
    await blurWindow();
    act(() => root?.unmount()); // 失焦往往伴随窗口隐藏/卸载
    root = null;
    await act(async () => {
      pending.forEach((rej) => rej(new Error('数据库忙')));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onErrorFallback).toHaveBeenCalledTimes(1);
    expect(String(onErrorFallback.mock.calls[0][0])).toContain('数据库忙');
  });

  it('blur 不切换笔记(onSwitchNote 不被调用)', async () => {
    updateNote.mockResolvedValue(note('改'));
    const onSwitchNote = vi.fn();
    await mount({ onSwitchNote });
    await type('改');
    await blurWindow();
    expect(onSwitchNote).not.toHaveBeenCalled();
  });

  it('宿主窗口失焦事件(Rust emit)-> 也触发保存', async () => {
    updateNote.mockResolvedValue(note('改了'));
    const onSaved = vi.fn();
    await mount({ onSaved });
    await type('改了');
    await emitHostBlur();
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('宿主事件与 DOM blur 同时到达 -> 只写一次(在飞守卫)', async () => {
    let resolveSave: ((n: Note) => void) | null = null;
    updateNote.mockImplementation(() => new Promise((res) => { resolveSave = res; }));
    await mount({});
    await type('改了');
    await emitHostBlur();
    await blurWindow(); // 第二条通道紧接着到达
    await act(async () => {
      resolveSave?.(note('改了'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateNote).toHaveBeenCalledTimes(1);
  });

  it('卸载即兜底保存一次;卸载后 blur 不再额外触发(监听已摘)', async () => {
    updateNote.mockResolvedValue(note('改了'));
    await mount({});
    await type('改了');
    act(() => root?.unmount());
    root = null;
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateNote).toHaveBeenCalledTimes(1); // 卸载兜底保存
    await blurWindow();
    expect(updateNote).toHaveBeenCalledTimes(1); // 监听已摘,不再加一次
    expect(tauriListeners.filter((l) => l.event === 'main-window-blur')).toHaveLength(0);
  });
});

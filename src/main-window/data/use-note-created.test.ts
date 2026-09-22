/**
 * 输入栏保存事件 -> 标签新鲜度(T6 修复轮 I2 绕过 2):
 * 原先只有「未翻页且非编辑态」才 refresh(内含 loadTags),已翻页/编辑中时新笔记的标签
 * 根本不进版本号。现在标签通知与「是否回首页重查」解耦 —— 后者可以跳过,前者绝不跳过。
 */
// @vitest-environment jsdom
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE } from '../stream/notes-list';
import { useNoteCreatedRefresh } from './use-note-created';

const { handlers } = vi.hoisted(() => ({ handlers: [] as Array<() => void> }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_event: string, handler: () => void) => {
    handlers.push(handler);
    return Promise.resolve(() => undefined);
  },
}));

const { notifyTagsChanged } = vi.hoisted(() => ({ notifyTagsChanged: vi.fn() }));
vi.mock('./tags-changed', () => ({ notifyTagsChanged }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function mount(
  noteCount: number,
  editingId: number | null,
  onRefresh: () => void,
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(function Probe(): ReactNode {
        useNoteCreatedRefresh(noteCount, editingId, onRefresh);
        return null;
      }),
    );
  });
}

/** 模拟 Rust 侧 save_input_note 落库后广播的 note-created */
async function fireNoteCreated(): Promise<void> {
  expect(handlers).toHaveLength(1);
  await act(async () => {
    handlers[0]();
  });
}

describe('useNoteCreatedRefresh:标签新鲜度与列表刷新解耦', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    handlers.length = 0;
    vi.clearAllMocks();
  });

  it('已翻页:通知标签出口,但不回首页重查(滚动位置不弹回)', async () => {
    const onRefresh = vi.fn();
    await mount(PAGE + 1, null, onRefresh);
    await fireNoteCreated();
    expect(notifyTagsChanged).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('编辑中:通知标签出口,但不卸载编辑面板', async () => {
    const onRefresh = vi.fn();
    await mount(3, 7, onRefresh);
    await fireNoteCreated();
    expect(notifyTagsChanged).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('首页且非编辑态:通知标签出口 + 回首页重查(行为不变)', async () => {
    const onRefresh = vi.fn();
    await mount(3, null, onRefresh);
    await fireNoteCreated();
    expect(notifyTagsChanged).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

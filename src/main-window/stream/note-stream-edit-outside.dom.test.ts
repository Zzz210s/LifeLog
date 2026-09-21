// @vitest-environment jsdom
/**
 * 「点另一条笔记正文 = 先存后进」在主窗流里的接线证据(jsdom 真渲染 NoteStream):
 * NoteItem 的正文带 data-note-body,编辑面板据此判定落点;保存成功才切过去,失败留在原条。
 * 另证:未变内容点区块外只退出编辑、不写库;面板之外的点击不会误触发保存。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { NoteStream } from './NoteStream';

const { updateNote } = vi.hoisted(() => ({ updateNote: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { updateNote } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (id: number, content: string): Note => ({
  id,
  content,
  created_at: '2026-09-21 08:00:00',
  tags: [],
});

const notes = [note(1, '第一条正文'), note(2, '第二条正文')];

let root: Root;
let host: HTMLDivElement;
let onEdit: ReturnType<typeof vi.fn>;
let onSwitchEdit: ReturnType<typeof vi.fn>;
let onEditCancel: ReturnType<typeof vi.fn>;
let onEditSaved: ReturnType<typeof vi.fn>;

async function mount(editingId: number | null): Promise<void> {
  await act(async () => {
    root.render(
      createElement(NoteStream, {
        notes,
        queryFailed: false,
        filterEmpty: true,
        onRetry: () => {},
        onClearFilters: () => {},
        onShowInput: () => {},
        activeTags: [],
        editingId,
        hasMore: false,
        loading: false,
        onLoadMore: () => {},
        onTagClick: () => {},
        onEdit,
        onSwitchEdit,
        onDelete: () => {},
        onEditSaved,
        onEditCancel,
        onToggleTask: () => {},
        onLinkError: () => {},
      })
    );
  });
}

const body = (id: number): Element => host.querySelector(`[data-note-body="${id}"]`) as Element;

const downOn = (el: Element): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const setSource = (v: string): Promise<void> =>
  act(async () => {
    const el = host.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  );
  updateNote.mockReset();
  onEdit = vi.fn();
  onSwitchEdit = vi.fn();
  onEditCancel = vi.fn();
  onEditSaved = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('点另一条笔记正文:先存后进', () => {
  it('内容改过:先写库(第一条),保存成功才切到第二条', async () => {
    updateNote.mockResolvedValue(note(1, '改后的正文'));
    await mount(1);
    await setSource('改后的正文');
    await downOn(body(2));
    expect(updateNote).toHaveBeenCalledWith(1, '改后的正文');
    expect(onEditSaved).toHaveBeenCalledWith(note(1, '改后的正文'));
    expect(onSwitchEdit).toHaveBeenCalledWith(notes[1]);
    expect(onEdit).not.toHaveBeenCalled(); // 进编辑由面板守卫接管,不让点击路径抢跑
  });

  it('内容未变:不写库也切过去(退出编辑由切换本身完成)', async () => {
    await mount(1);
    await downOn(body(2));
    expect(updateNote).not.toHaveBeenCalled();
    expect(onSwitchEdit).toHaveBeenCalledWith(notes[1]);
    expect(onEditCancel).not.toHaveBeenCalled();
  });

  it('保存失败:留在第一条编辑态,不切走(也不静默)', async () => {
    updateNote.mockRejectedValue(new Error('IPC 失败'));
    await mount(1);
    await setSource('改后的正文');
    await downOn(body(2));
    expect(onSwitchEdit).not.toHaveBeenCalled();
    expect(onEditCancel).not.toHaveBeenCalled();
    expect(host.textContent).toContain('保存失败');
  });
});

describe('点区块外的非笔记处:保存后退出编辑', () => {
  it('未变内容:只退出编辑,零写入', async () => {
    await mount(1);
    await downOn(host);
    expect(updateNote).not.toHaveBeenCalled();
    expect(onEditCancel).toHaveBeenCalledTimes(1);
    expect(onSwitchEdit).not.toHaveBeenCalled();
  });

  it('改过内容:写库成功后退出编辑(onSaved 负责退出,不再重复取消)', async () => {
    updateNote.mockResolvedValue(note(1, '改后的正文'));
    await mount(1);
    await setSource('改后的正文');
    await downOn(host);
    expect(updateNote).toHaveBeenCalledWith(1, '改后的正文');
    expect(onEditSaved).toHaveBeenCalled();
    expect(onEditCancel).not.toHaveBeenCalled();
  });
});

describe('非编辑态不受影响', () => {
  it('没有编辑面板时点正文仍走 onEdit(不变)', async () => {
    await mount(null);
    await downOn(body(2));
    expect(onEdit).not.toHaveBeenCalled(); // 真实点击走 click 通道;pointerdown 不该直接进编辑
    await act(async () => {
      body(2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onEdit).toHaveBeenCalledWith(notes[1]);
  });
});

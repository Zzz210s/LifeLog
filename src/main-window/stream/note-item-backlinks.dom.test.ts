// @vitest-environment jsdom
/**
 * L3 卡片底部「被引用 N」+ 反向引用面板的组件级证据:
 * N=0 不显示按钮也不拉入链;N>0 点开列出引用来源;点条目触发跳转回调(复用 L2 通道)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { NoteItem } from './NoteItem';

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
const { noteLinks } = vi.hoisted(() => ({
  noteLinks: vi.fn(async (_id: number) => ({
    outbound: [],
    backlinks: [
      { sourceId: 21, title: '来源甲' },
      { sourceId: 22, title: '来源乙' },
    ],
  })),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));
vi.mock('../../shared/api', () => ({ api: { noteLinks } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (): Note => ({
  id: 7, content: '目标笔记', created_at: '2026-10-01 08:00:00', tags: [], links: [],
});

let root: Root;
let host: HTMLDivElement;
let opened: number[];
let edits: number;

async function mount(backlinkCount: number): Promise<void> {
  opened = [];
  edits = 0;
  await act(async () => {
    root.render(
      createElement(NoteItem, {
        note: note(),
        activeTags: [],
        onTagClick: () => {},
        onEdit: () => { edits++; },
        onDelete: () => {},
        onToggleTask: () => {},
        backlinkCount,
        onOpenNote: (id) => opened.push(id),
      })
    );
  });
}

const button = (sel: string): HTMLButtonElement => {
  const el = host.querySelector(sel);
  if (!el) throw new Error('未找到元素: ' + sel);
  return el as HTMLButtonElement;
};

const click = (el: Element): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });

beforeEach(() => {
  noteLinks.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('卡片底部「被引用 N」(L3)', () => {
  it('N=0 不显示按钮,也不拉入链', async () => {
    await mount(0);
    expect(host.querySelector('[data-testid="backlink-count"]')).toBeNull();
    expect(noteLinks).not.toHaveBeenCalled();
  });

  it('N>0 显示按钮;点开列出引用来源;点条目跳转且不进编辑', async () => {
    await mount(2);
    const btn = button('[data-testid="backlink-count"]');
    expect(btn.textContent).toBe('被引用 2');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="backlinks-panel"]')).toBeNull(); // 未点开不渲染、不拉取
    expect(noteLinks).not.toHaveBeenCalled();

    await click(btn);
    expect(noteLinks).toHaveBeenCalledWith(7);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const panel = host.querySelector('[data-testid="backlinks-panel"]');
    expect(panel?.textContent).toContain('来源甲');
    expect(panel?.textContent).toContain('来源乙');
    expect(edits).toBe(0); // 点按钮/面板不进编辑态

    const first = panel!.querySelectorAll('button')[0];
    await click(first);
    expect(opened).toEqual([21]);
  });
});

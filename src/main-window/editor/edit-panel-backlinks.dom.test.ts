// @vitest-environment jsdom
/**
 * L3 编辑面板反向引用列表:面板自身在挂载时拉 `note_links`,
 * 有入链时列出**只读**来源(无跳转按钮);无入链时不渲染空列表。
 * 卡片上的「被引用 N」已按下线(见 stream/note-item-no-backlinks.dom.test.ts),
 * 编辑面板不再依赖外部传入计数。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { EditPanel } from './EditPanel';

const { updateNote, parseNoteSource, noteLinks } = vi.hoisted(() => ({
  updateNote: vi.fn(),
  parseNoteSource: vi.fn(async (s: string) => ({ content: s, tags: [] })),
  noteLinks: vi.fn(async (_id: number) => ({
    outbound: [],
    backlinks: [{ sourceId: 5, title: '引用来源' }],
  })),
}));
vi.mock('../../shared/api', () => ({ api: { updateNote, parseNoteSource, noteLinks } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note: Note = { id: 7, content: '正文', created_at: '2026-10-01 08:00:00', tags: [], links: [] };

let root: Root;
let host: HTMLDivElement;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(EditPanel, { note, onSaved: () => {}, onCancel: () => {} }));
  });
}

beforeEach(() => {
  noteLinks.mockClear();
  noteLinks.mockImplementation(async (_id: number) => ({
    outbound: [],
    backlinks: [{ sourceId: 5, title: '引用来源' }],
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('编辑面板反向引用列表(L3)', () => {
  it('有入链:列出只读来源(无按钮,不可跳转)', async () => {
    await mount();
    const panel = host.querySelector('[data-testid="backlinks-panel"]');
    expect(panel?.textContent).toContain('引用来源');
    expect(panel!.querySelectorAll('button')).toHaveLength(0);
    expect(noteLinks).toHaveBeenCalledWith(7);
  });

  it('无入链:面板返回 null,不渲染空列表(仍会拉一次)', async () => {
    noteLinks.mockImplementation(async (_id: number) => ({ outbound: [], backlinks: [] }));
    await mount();
    expect(host.querySelector('[data-testid="backlinks-panel"]')).toBeNull();
    expect(noteLinks).toHaveBeenCalledWith(7);
  });
});

// @vitest-environment jsdom
/**
 * L3 编辑面板反向引用列表:backlinkCount>0 时列出**只读**来源(无跳转按钮);
 * 未传计数时不渲染也不拉取(既有编辑面板用例的 api 桩因此不受影响)。
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

async function mount(extra: Record<string, unknown>): Promise<void> {
  await act(async () => {
    root.render(createElement(EditPanel, { note, onSaved: () => {}, onCancel: () => {}, ...extra }));
  });
}

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

describe('编辑面板反向引用列表(L3)', () => {
  it('backlinkCount>0:列出只读来源(无按钮,不可跳转)', async () => {
    await mount({ backlinkCount: 1 });
    const panel = host.querySelector('[data-testid="backlinks-panel"]');
    expect(panel?.textContent).toContain('引用来源');
    expect(panel!.querySelectorAll('button')).toHaveLength(0);
    expect(noteLinks).toHaveBeenCalledWith(7);
  });

  it('未传 backlinkCount:不渲染也不拉取', async () => {
    await mount({});
    expect(host.querySelector('[data-testid="backlinks-panel"]')).toBeNull();
    expect(noteLinks).not.toHaveBeenCalled();
  });
});

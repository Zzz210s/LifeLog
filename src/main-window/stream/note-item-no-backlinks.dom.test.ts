// @vitest-environment jsdom
/**
 * 反向守护(用户 2026-10-11「被引用不显示标签,仅引用的显示」):
 * 条目卡片底部**不再**出现「被引用 N」——没有徽标文本、没有 `backlink-count` 节点,
 * 也不发 `note_link_counts` / `noteLinks` 一类的读取(卡片不再感知入链)。
 * 编辑面板的反向引用列表另有用例守护(editor/edit-panel-backlinks.dom.test.ts)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { NoteItem } from './NoteItem';

const { noteLinks, noteLinkCounts } = vi.hoisted(() => ({
  noteLinks: vi.fn(async (_id: number) => ({ outbound: [], backlinks: [] })),
  noteLinkCounts: vi.fn(async (_ids: number[]) => ({})),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { noteLinks, noteLinkCounts } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (): Note => ({
  id: 7, content: '目标笔记', created_at: '2026-10-01 08:00:00', tags: [], links: [],
});

let root: Root;
let host: HTMLDivElement;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(NoteItem, {
        note: note(),
        activeTags: [],
        onTagClick: () => {},
        onEdit: () => {},
        onDelete: () => {},
        onToggleTask: () => {},
        onOpenNote: () => {},
        onLinkError: () => {},
      })
    );
  });
}

beforeEach(() => {
  noteLinks.mockClear();
  noteLinkCounts.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('条目卡片不含「被引用」(反向守护)', () => {
  it('没有 backlink-count 节点,正文里也不出现「被引用」', async () => {
    await mount();
    expect(host.querySelector('[data-testid="backlink-count"]')).toBeNull();
    expect(host.textContent ?? '').not.toContain('被引用');
  });

  it('不拉入链:note_link_counts / noteLinks 都没被调用', async () => {
    await mount();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(noteLinkCounts).not.toHaveBeenCalled();
    expect(noteLinks).not.toHaveBeenCalled();
  });
});

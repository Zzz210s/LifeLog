// @vitest-environment jsdom
/**
 * 卡片上的批量 checkbox(spec 2026-10-17 §3.2/§7.1/§7.3):
 * 批量态出勾选框、点它不冒泡成"点正文进编辑"、点正文仍进编辑、单条删除按钮隐藏。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { NoteItem } from './NoteItem';

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note: Note = {
  id: 7,
  content: '正文内容',
  created_at: '2026-10-17 08:00:00',
  links: [],
  tags: [],
};

interface Calls {
  edit: number;
  del: number;
  toggles: number;
}

let root: Root;
let host: HTMLDivElement;
let calls: Calls;

const mount = async (batch?: { selected: boolean }): Promise<void> => {
  calls = { edit: 0, del: 0, toggles: 0 };
  await act(async () => {
    root.render(
      createElement(NoteItem, {
        note,
        activeTags: [],
        onTagClick: () => {},
        onEdit: () => {
          calls.edit++;
        },
        onDelete: () => {
          calls.del++;
        },
        onToggleTask: () => {},
        batch:
          batch === undefined
            ? undefined
            : {
                on: true,
                selected: batch.selected,
                onToggle: () => {
                  calls.toggles++;
                },
              },
      })
    );
  });
};

const click = (el: Element): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('批量态下的条目卡片', () => {
  it('批量开:出勾选框,选中态跟随 selected', async () => {
    await mount({ selected: true });
    const box = host.querySelector('[data-testid="batch-check"]') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.checked).toBe(true);
    expect(box.getAttribute('aria-label')).toBe('选中这条条目');
  });

  it('批量关(不传 batch):不出勾选框', async () => {
    await mount();
    expect(host.querySelector('[data-testid="batch-check"]')).toBeNull();
  });

  it('点勾选框只切选中,不进编辑', async () => {
    await mount({ selected: false });
    await click(host.querySelector('[data-testid="batch-check"]')!);
    expect(calls.toggles).toBe(1);
    expect(calls.edit).toBe(0);
  });

  it('点正文仍进编辑(共存,spec §7.1)', async () => {
    await mount({ selected: false });
    await click(host.querySelector('[data-note-body="7"]')!);
    expect(calls.edit).toBe(1);
    expect(calls.toggles).toBe(0);
  });

  it('批量态隐藏单条删除;非批量态保留', async () => {
    await mount({ selected: false });
    expect(host.textContent).not.toContain('删除');
    await mount();
    expect(host.textContent).toContain('删除');
  });
});

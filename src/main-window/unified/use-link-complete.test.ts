// @vitest-environment jsdom
/**
 * 统一输入框 `[[` 补全的笔记 MRU(遗留1):空查询 MRU 优先、采纳后进 MRU 并重排;
 * 非空查询交给 fuzzy 分数,MRU 不插队。hook 级直测(组件级口径见 unified-link-complete.dom.test.ts)。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteMruSource } from '../../shared/note-mru';
import type { NoteTitle } from '../../shared/types';
import { useLinkComplete } from './use-link-complete';
import type { LinkComplete } from './use-link-complete';

const { completeNotes } = vi.hoisted(() => ({ completeNotes: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { completeNotes } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeMru = (): NoteMruSource => {
  const counts = new Map<string, number>();
  return {
    entries: () => [...counts.entries()].map(([id, count]) => ({ id, count })),
    touch: (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1),
  };
};

let root: Root;
let host: HTMLDivElement;
let api: LinkComplete | null = null;

function Probe(p: { raw: string; caret: number; mru: NoteMruSource }): ReactNode {
  api = useLinkComplete({ raw: p.raw, caret: p.caret, dataVersion: 0, mru: p.mru });
  return null;
}
const labels = () => api!.controller.rows.map((r) => r.item.label);
const render = (raw: string, caret: number, mru: NoteMruSource) =>
  act(async () => {
    root.render(createElement(Probe, { raw, caret, mru }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  completeNotes.mockReset();
  completeNotes.mockResolvedValue([
    { id: 1, title: '买牛奶' },
    { id: 2, title: '购物清单' },
  ] as NoteTitle[]);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useLinkComplete:空查询按 MRU', () => {
  it('无 MRU 按池序;采纳「购物清单」后它排第一;非空查询不受 MRU 影响', async () => {
    const mru = fakeMru();
    await render('[[', 2, mru);
    expect(completeNotes).toHaveBeenCalledTimes(1);
    expect(labels()).toEqual(['买牛奶', '购物清单']); // 池序(id 升序)

    await act(async () => {
      api!.accept(1); // 采纳第二行 = 购物清单
    });
    expect(labels()).toEqual(['购物清单', '买牛奶']); // 刚采纳的进 MRU 档 → 排第一

    await render('[[牛', 3, mru);
    expect(labels()).toEqual(['买牛奶']); // fuzzy 分数说话,MRU 不插队
  });
});

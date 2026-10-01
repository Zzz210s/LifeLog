// @vitest-environment jsdom
/**
 * L3 计数批量取的组件级证据:一页所有 id 只发**一次** `note_link_counts`,
 * 结果按 id 分给各卡;id 集合未变不重查;拉取失败退化为空(不显示徽标)。
 */
import { act, createElement, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { useBacklinkCounts } from './use-backlink-counts';

const { noteLinkCounts } = vi.hoisted(() => ({
  noteLinkCounts: vi.fn(async (_ids: number[]) => ({ 3: 2, 4: 1 })),
}));
vi.mock('../../shared/api', () => ({ api: { noteLinkCounts } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (id: number): Note => ({ id, content: 'n' + id, created_at: '2026-10-01 08:00:00', tags: [], links: [] });

let root: Root;
let host: HTMLDivElement;
let counts: Record<number, number> = {};
let bump: ((n: number) => void) | null = null;

function Probe({ notes }: { notes: readonly Note[] }): ReactNode {
  const [extra, setExtra] = useState(0);
  bump = setExtra;
  const got = useBacklinkCounts(notes);
  counts = got;
  return createElement('span', null, String(extra));
}

const settle = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });

beforeEach(() => {
  noteLinkCounts.mockClear();
  noteLinkCounts.mockImplementation(async (_ids: number[]) => ({ 3: 2, 4: 1 }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useBacklinkCounts(L3 批量计数)', () => {
  it('一页多 id 只发一次批量请求,结果分给各卡', async () => {
    await act(async () => root.render(createElement(Probe, { notes: [mk(3), mk(4)] })));
    await settle();
    expect(noteLinkCounts).toHaveBeenCalledTimes(1);
    expect(noteLinkCounts).toHaveBeenCalledWith([3, 4]);
    expect(counts).toEqual({ 3: 2, 4: 1 });
  });

  it('同 id 集合重渲不重查(按结构指纹而非对象引用)', async () => {
    await act(async () => root.render(createElement(Probe, { notes: [mk(3), mk(4)] })));
    await settle();
    await act(async () => bump?.(1)); // 触发一次重渲,notes 引用不变
    await settle();
    expect(noteLinkCounts).toHaveBeenCalledTimes(1);
  });

  it('空列表不请求;失败退化为空计数', async () => {
    await act(async () => root.render(createElement(Probe, { notes: [] })));
    await settle();
    expect(noteLinkCounts).not.toHaveBeenCalled();
    expect(counts).toEqual({});

    noteLinkCounts.mockRejectedValueOnce(new Error('boom'));
    await act(async () => root.render(createElement(Probe, { notes: [mk(9)] })));
    await settle();
    expect(counts).toEqual({});
  });
});

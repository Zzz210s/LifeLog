// @vitest-environment jsdom
/**
 * 合流口(设计 §6.4):无 groupBy 时平铺原样透传;有 groupBy 时切到分组模式;
 * degraded 退化为平铺并给中文提示,slow 仍分组只提示。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import { useStreamFeed } from './use-stream-feed';

const { queryNotes, groupSkeleton, queryGrouped, queryGroupPage } = vi.hoisted(() => ({
  queryNotes: vi.fn(),
  groupSkeleton: vi.fn(),
  queryGrouped: vi.fn(),
  queryGroupPage: vi.fn(async (): Promise<Note[]> => []),
}));
vi.mock('../../shared/api', () => ({ api: { queryNotes, groupSkeleton, queryGrouped, queryGroupPage } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (id: number): Note => ({ id, content: `n${id}`, created_at: '2026-10-06 10:00:00', tags: [], links: [] });
const skeleton = (over: Record<string, unknown> = {}) => ({
  groups: [{ key: '地点/美国', label: '美国', count: 30, orderKey: 'a' }],
  elapsedMs: 10,
  degraded: false,
  slow: false,
  ...over,
});
const cond = (path: string | null): FilterConditions =>
  path === null ? EMPTY_FILTER : { ...EMPTY_FILTER, groupBy: { path, dir: 'asc' } };

let latest: ReturnType<typeof useStreamFeed> | null = null;
let root: Root;
let host: HTMLDivElement;

// 稳定引用:每次渲染换新会让两个 hook 的 load/fetchPage 身份变,effect 反复跑(与 App 一致)
const noErr = (): void => {};
const noClear = (): void => {};

function Harness(p: { conditions: FilterConditions }): ReactNode {
  latest = useStreamFeed(p.conditions, noErr, noClear);
  return null;
}
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};
const mount = async (conditions: FilterConditions): Promise<void> => {
  act(() => root.render(createElement(Harness, { conditions })));
  await settle();
};

beforeEach(() => {
  queryNotes.mockResolvedValue([note(1), note(2)]);
  groupSkeleton.mockResolvedValue(skeleton());
  queryGrouped.mockResolvedValue([{ key: '地点/美国', notes: [note(11), note(12)] }]);
  queryGroupPage.mockResolvedValue([]);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  latest = null;
});

describe('useStreamFeed 平铺路径(一行不改)', () => {
  it('无 groupBy:grouping 与 notice 都是 null,notes 来自 queryNotes', async () => {
    await mount(cond(null));
    expect(queryNotes).toHaveBeenCalled();
    expect(groupSkeleton).not.toHaveBeenCalled();
    expect(latest?.grouping).toBe(null);
    expect(latest?.notice).toBe(null);
    expect(latest?.notes.map((n) => n.id)).toEqual([1, 2]);
  });
});

describe('useStreamFeed 分组路径与提示文案', () => {
  it('有 groupBy:grouping 非空,notes = 组内已加载笔记,无提示', async () => {
    await mount(cond('地点'));
    expect(latest?.grouping?.groups.map((g) => g.sessionKey)).toEqual(['地点/美国']);
    expect(latest?.notes.map((n) => n.id)).toEqual([11, 12]);
    expect(latest?.notice).toBe(null);
    expect(latest?.hasMore).toBe(false);
  });

  it('degraded(组数 > 300):退化为平铺 + 「分组结果过多，已按平铺显示」', async () => {
    groupSkeleton.mockResolvedValue(skeleton({ groups: [], degraded: true }));
    await mount(cond('地点'));
    expect(latest?.grouping).toBe(null);
    expect(latest?.notice).toBe('分组结果过多，已按平铺显示');
    expect(latest?.notes.map((n) => n.id)).toEqual([1, 2]); // 平铺兜底
  });

  it('slow(骨架 > 200ms):仍分组 + 「结果很多，建议加筛选」', async () => {
    groupSkeleton.mockResolvedValue(skeleton({ slow: true }));
    await mount(cond('地点'));
    expect(latest?.grouping).not.toBe(null);
    expect(latest?.notice).toBe('结果很多，建议加筛选');
  });
});

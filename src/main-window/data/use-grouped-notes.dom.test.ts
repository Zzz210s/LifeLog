// @vitest-environment jsdom
/**
 * 分组状态机(设计 §6.4):骨架 -> 每组首屏 K=20 -> 组内续页(offset **只数本组**),
 * 折叠只存会话内且只影响本组;degraded 退化为平铺、slow 只提示;filterKey 变化 -> 重查 + 折叠重置。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import { useGroupedNotes, type GroupedNotes } from './use-grouped-notes';

const { groupSkeleton, queryGrouped, queryGroupPage } = vi.hoisted(() => ({
  groupSkeleton: vi.fn<(conditions: unknown) => Promise<unknown>>(),
  queryGrouped: vi.fn<(conditions: unknown) => Promise<unknown>>(),
  queryGroupPage:
    vi.fn<(conditions: unknown, key: string | null, offset: number) => Promise<unknown[]>>(),
}));
vi.mock('../../shared/api', () => ({ api: { groupSkeleton, queryGrouped, queryGroupPage } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (id: number): Note => ({ id, content: `n${id}`, created_at: '2026-10-06 10:00:00', tags: [], links: [] });
const skeleton = (over: Record<string, unknown> = {}) => ({
  groups: [
    { key: '地点/美国', label: '美国', count: 30, orderKey: 'a' },
    { key: '地点/英国', label: '英国', count: 5, orderKey: 'b' },
  ],
  elapsedMs: 10,
  degraded: false,
  slow: false,
  ...over,
});
const grouped = () => [
  { key: '地点/美国', notes: [note(1), note(2)] },
  { key: '地点/英国', notes: [note(3)] },
];
const cond = (path: string): FilterConditions => ({ ...EMPTY_FILTER, groupBy: { path, dir: 'asc' } });

let latest: GroupedNotes | null = null;
let root: Root;
let host: HTMLDivElement;

// 错误出口必须是稳定引用(与 App 的 useAppErrors 一致):每次渲染换新会让 load 身份变,effect 反复跑
const noErr = (): void => {};
const noClear = (): void => {};

function Harness(p: { conditions: FilterConditions; onResult: (g: GroupedNotes) => void }): ReactNode {
  const r = useGroupedNotes(p.conditions, noErr, noClear);
  p.onResult(r);
  return createElement(
    'div',
    null,
    ...r.groups.map((g) =>
      createElement(
        'button',
        { key: g.sessionKey, 'data-testid': `more-${g.sessionKey}`, disabled: !g.hasMore, onClick: () => r.loadMoreGroup(g.sessionKey) },
        `more ${g.sessionKey}`,
      ),
    ),
    ...r.groups.map((g) =>
      createElement('button', { key: `t-${g.sessionKey}`, 'data-testid': `toggle-${g.sessionKey}`, onClick: () => r.toggleCollapsed(g.sessionKey) }, `toggle ${g.sessionKey}`),
    ),
  );
}
const render = (conditions: FilterConditions): void => {
  act(() => root.render(createElement(Harness, { conditions, onResult: (g) => { latest = g; } })));
};
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};
const click = async (id: string): Promise<void> => {
  // 按 data-testid 精确匹配(NUL 哨兵键写不进 CSS 选择器)
  const el = [...host.querySelectorAll('button')].find((b) => b.getAttribute('data-testid') === id) as HTMLElement;
  await act(async () => {
    el.click();
  });
  await settle();
};

beforeEach(() => {
  groupSkeleton.mockResolvedValue(skeleton());
  queryGrouped.mockResolvedValue(grouped());
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

describe('分组状态机:骨架 + 首屏 + 组内续页', () => {
  it('骨架给组序与总数,首屏按组填充;hasMore = 已加载 < 组总数', async () => {
    render(cond('地点'));
    await settle();
    expect(latest?.enabled).toBe(true);
    expect(latest?.groups.map((g) => [g.sessionKey, g.label, g.count, g.hasMore])).toEqual([
      ['地点/美国', '美国', 30, true],
      ['地点/英国', '英国', 5, true],
    ]);
    expect(latest?.groups[0].notes.map((n) => n.id)).toEqual([1, 2]);
    expect(latest?.allNotes.map((n) => n.id)).toEqual([1, 2, 3]);
  });

  it('组内续页的 offset 只数本组:美国传 2,英国传 1;别的组读数不变', async () => {
    queryGroupPage.mockImplementation(async (_c, key: string | null, offset: number) =>
      key === '地点/美国' && offset === 2 ? [note(41), note(42)] : [note(99)],
    );
    render(cond('地点'));
    await settle();
    await click('more-地点/美国');
    const call = queryGroupPage.mock.calls[0];
    expect(call[1]).toBe('地点/美国');
    expect(call[2]).toBe(2); // 本组已加载数,不是全局长度(全局是 3)
    expect(latest?.groups[0].notes.map((n) => n.id)).toEqual([1, 2, 41, 42]);
    expect(latest?.groups[1].notes.map((n) => n.id)).toEqual([3]);
    expect(queryGroupPage).toHaveBeenCalledTimes(1);
  });

  it('哨兵组(key=null)用哨兵会话键,续页传 null', async () => {
    groupSkeleton.mockResolvedValue(skeleton({ groups: [{ key: null, label: '（无 地点）', count: 9, orderKey: 'z' }] }));
    queryGrouped.mockResolvedValue([{ key: null, notes: [note(7)] }]);
    render(cond('地点'));
    await settle();
    expect(latest?.groups[0].sessionKey).toBe('\0none');
    await click('more-\u0000none');
    expect(queryGroupPage.mock.calls[0][1]).toBe(null);
  });
});

describe('分组状态机:折叠隔离 / 降级 / 慢 / 条件变化', () => {
  it('折叠只记本组会话键,不影响别的组', async () => {
    render(cond('地点'));
    await settle();
    await click('toggle-地点/美国');
    expect([...(latest?.collapsed ?? [])]).toEqual(['地点/美国']);
    expect(latest?.groups[1].notes.map((n) => n.id)).toEqual([3]);
  });

  it('degraded(组数 > 300):不发分组查询,groups 空、degraded 真', async () => {
    groupSkeleton.mockResolvedValue(skeleton({ groups: [], degraded: true }));
    render(cond('地点'));
    await settle();
    expect(latest?.enabled).toBe(true);
    expect(latest?.degraded).toBe(true);
    expect(latest?.groups).toEqual([]);
    expect(queryGrouped).not.toHaveBeenCalled();
  });

  it('slow(骨架 > 200ms):仍分组,只置 slow 标志', async () => {
    groupSkeleton.mockResolvedValue(skeleton({ slow: true }));
    render(cond('地点'));
    await settle();
    expect(latest?.slow).toBe(true);
    expect(latest?.degraded).toBe(false);
    expect(latest?.groups).toHaveLength(2);
  });

  it('条件值变化(filterKey)触发整组重查并重置折叠态', async () => {
    render(cond('地点'));
    await settle();
    await click('toggle-地点/美国');
    expect(latest?.collapsed.size).toBe(1);
    render(cond('状态'));
    await settle();
    expect(latest?.collapsed.size).toBe(0);
    expect(groupSkeleton).toHaveBeenCalledTimes(2);
  });

  it('groupBy 为空:enabled 假、不发任何分组查询', async () => {
    render({ ...EMPTY_FILTER, groupBy: null });
    await settle();
    expect(latest?.enabled).toBe(false);
    expect(groupSkeleton).not.toHaveBeenCalled();
  });
});

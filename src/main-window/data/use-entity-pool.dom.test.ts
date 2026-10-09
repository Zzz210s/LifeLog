// @vitest-environment jsdom
/**
 * 实体池缓存的组件级证据(计划 T3.2):首次把两路 IPC(全部实体 + 树内实体)合并成一份池、
 * 同版本重渲不重取、版本变化重取一次、失败退化为空池且不抛、卸载后不再接受迟到结果、
 * 跨窗 note-created 触发重取。
 */
import { act, createElement, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityCandidate } from '../../shared/entity-pool';
import type { NoteTitle, TagCount } from '../../shared/types';
import { useEntityPool } from './use-entity-pool';

const { completeNotes, listTags } = vi.hoisted(() => ({
  completeNotes: vi.fn(async (): Promise<NoteTitle[]> => [{ id: 1, title: '甲' }]),
  listTags: vi.fn(async (): Promise<TagCount[]> => []),
}));
vi.mock('../../shared/api', () => ({ api: { completeNotes, listTags } }));

// 跨窗事件订阅:记下每个 handler,退订时移除(供「卸载后不再重取」断言)
const { handlers } = vi.hoisted(() => ({ handlers: [] as Array<() => void> }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_event: string, handler: () => void) => {
    handlers.push(handler);
    return Promise.resolve(() => {
      const i = handlers.indexOf(handler);
      if (i >= 0) handlers.splice(i, 1);
    });
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const treeRow = (id: number, path: string): TagCount => ({
  id,
  path,
  depth: 0,
  sort_order: 0,
  self_count: 0,
  subtree_count: 0,
});

let root: Root;
let host: HTMLDivElement;
let pool: readonly EntityCandidate[] = [];
let tree: readonly EntityCandidate[] = [];
let ready = false;
let setVersion: ((v: number) => void) | null = null;
let bump: (() => void) | null = null;

function Probe({ version }: { version: number }): ReactNode {
  const [v, setV] = useState(version);
  const [extra, setExtra] = useState(0);
  setVersion = setV;
  bump = () => setExtra((n) => n + 1);
  const got = useEntityPool(v);
  pool = got.pool;
  tree = got.tree;
  ready = got.ready;
  return createElement('span', null, String(extra));
}

const settle = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });

beforeEach(() => {
  completeNotes.mockClear();
  listTags.mockClear();
  completeNotes.mockImplementation(async () => [{ id: 1, title: '甲' }]);
  listTags.mockImplementation(async () => [treeRow(2, '工作')]);
  handlers.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useEntityPool(实体池缓存)', () => {
  it('首次取全池:两路 IPC 各一次,合并成全部实体 + 树内子集', async () => {
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    await settle();
    expect(completeNotes).toHaveBeenCalledTimes(1);
    expect(listTags).toHaveBeenCalledTimes(1);
    expect(pool.map((e) => e.id)).toEqual([1, 2]);
    expect(tree.map((e) => e.id)).toEqual([2]);
    expect(pool.find((e) => e.id === 1)?.path).toBeNull();
    expect(ready).toBe(true);

    await act(async () => bump?.());
    await settle();
    expect(completeNotes).toHaveBeenCalledTimes(1); // 同版本重渲不重取
  });

  it('版本变化重取一次', async () => {
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    await settle();
    await act(async () => setVersion?.(1));
    await settle();
    expect(completeNotes).toHaveBeenCalledTimes(2);
    expect(listTags).toHaveBeenCalledTimes(2);
  });

  it('失败退化为空池、ready=false、不抛', async () => {
    completeNotes.mockRejectedValueOnce(new Error('boom'));
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    await settle();
    expect(pool).toEqual([]);
    expect(tree).toEqual([]);
    expect(ready).toBe(false);
  });

  it('卸载后迟到的结果不再进入状态', async () => {
    let release!: (pool: NoteTitle[]) => void;
    completeNotes.mockImplementationOnce(() => new Promise<NoteTitle[]>((res) => (release = res)));
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    act(() => root.unmount());
    release([{ id: 2, title: '乙' }]);
    await settle();
    expect(pool).toEqual([]); // 迟到的池没有被接受
  });

  it('跨窗事件 note-created 到达 -> 池重取一次(版本号没变也重取)', async () => {
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    await settle();
    expect(completeNotes).toHaveBeenCalledTimes(1);
    expect(handlers).toHaveLength(1);
    await act(async () => {
      handlers[0]();
    });
    await settle();
    expect(completeNotes).toHaveBeenCalledTimes(2);
  });

  it('卸载后退订跨窗事件,不再重取', async () => {
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    await settle();
    const handler = handlers[0];
    act(() => root.unmount());
    expect(handlers).toHaveLength(0); // 已退订
    await act(async () => {
      handler();
    });
    await settle();
    expect(completeNotes).toHaveBeenCalledTimes(1);
  });
});

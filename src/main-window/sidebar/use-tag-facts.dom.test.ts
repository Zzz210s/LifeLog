// @vitest-environment jsdom
/**
 * 标签关系事实改成批量一次的组件级证据(标签关系统一 spec §7):
 *   一次 `list_tag_facts` 拿全量,不再逐标签调 `list_tag_relations` / `list_tag_carries`;
 *   只保留当前可见的标签;出边原样带 remark 供行内小字与悬浮卡片共用;读数失败回空值不抛。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagFactsBundle } from '../../shared/tag-facts-types';
import { useTagFacts, type TagFacts } from './use-tag-facts';

const { listTagFacts, listTagRelations, listTagCarries } = vi.hoisted(() => ({
  listTagFacts: vi.fn<() => Promise<TagFactsBundle>>(),
  listTagRelations: vi.fn(),
  listTagCarries: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { listTagFacts, listTagRelations, listTagCarries } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REL = { toTagId: 7, path: '地点轴/国籍', name: '国籍', remark: '国别' };
const BUNDLE: TagFactsBundle = {
  facts: [
    { tagId: 1, relations: [REL] },
    { tagId: 99, relations: [] },
  ],
};

let root: Root;
let host: HTMLDivElement;
let facts: ReadonlyMap<number, TagFacts> = new Map();

function Probe(): ReactNode {
  facts = useTagFacts([1, 2], 0);
  return createElement('span', null, String(facts.size));
}

const settle = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });

beforeEach(() => {
  listTagFacts.mockReset();
  listTagFacts.mockResolvedValue(BUNDLE);
  listTagRelations.mockReset();
  listTagCarries.mockReset();
  facts = new Map();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useTagFacts(批量一次)', () => {
  it('一次 list_tag_facts 拿全量,不发起逐标签 IPC', async () => {
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(listTagFacts).toHaveBeenCalledTimes(1);
    expect(listTagRelations).not.toHaveBeenCalled();
    expect(listTagCarries).not.toHaveBeenCalled();
  });

  it('只保留可见标签;出边原样带 remark', async () => {
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect([...facts.keys()]).toEqual([1]);
    expect(facts.get(1)?.relations).toEqual([REL]);
  });

  it('读数失败回空值且不抛', async () => {
    listTagFacts.mockRejectedValueOnce(new Error('boom'));
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(facts.size).toBe(0);
  });
});

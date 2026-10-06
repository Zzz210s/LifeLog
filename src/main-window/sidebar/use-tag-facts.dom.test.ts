// @vitest-environment jsdom
/**
 * 标签事实读取改成批量一次的组件级证据(标签类型 spec §5 / Task 5 欠账 2):
 *   一次 `list_tag_facts` 拿全量 + 类型表,不再逐标签调 `list_tag_types` / `list_tag_carries`;
 *   只保留当前可见的标签;携带目标按类型表换算成「类型 -> 值」;读数失败回空值不抛。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagFactsBundle } from '../../shared/tag-facts-types';
import { useTagFacts, type TagFacts } from './use-tag-facts';

const { listTagFacts, listTagTypes, listTagCarries } = vi.hoisted(() => ({
  listTagFacts: vi.fn<() => Promise<TagFactsBundle>>(),
  listTagTypes: vi.fn(),
  listTagCarries: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { listTagFacts, listTagTypes, listTagCarries } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REL = { toTagId: 7, path: '地点轴/国籍', name: '国籍', remark: '' };
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
  listTagTypes.mockReset();
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
    expect(listTagTypes).not.toHaveBeenCalled();
    expect(listTagCarries).not.toHaveBeenCalled();
  });

  it('只保留可见标签;出边按目标名(已剥 md)给出关系小字', async () => {
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect([...facts.keys()]).toEqual([1]);
    expect(facts.get(1)?.types).toEqual([]);
    expect(facts.get(1)?.carry).toEqual([{ type: '国籍', value: '' }]);
  });

  it('读数失败回空值且不抛', async () => {
    listTagFacts.mockRejectedValueOnce(new Error('boom'));
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(facts.size).toBe(0);
  });
});

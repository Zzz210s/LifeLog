// @vitest-environment jsdom
/**
 * 标签事实读取改成批量一次的组件级证据(标签角色 spec §5 / Task 5 欠账 2):
 *   一次 `list_tag_facts` 拿全量 + 角色表,不再逐标签调 `list_tag_roles` / `list_tag_carries`;
 *   只保留当前可见的标签;携带目标按角色表换算成「角色 -> 值」;读数失败回空值不抛。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagFactsBundle } from '../../shared/tag-facts-types';
import { useTagFacts, type TagFacts } from './use-tag-facts';

const { listTagFacts, listTagRoles, listTagCarries } = vi.hoisted(() => ({
  listTagFacts: vi.fn<() => Promise<TagFactsBundle>>(),
  listTagRoles: vi.fn(),
  listTagCarries: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { listTagFacts, listTagRoles, listTagCarries } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GUO = { tagId: 7, path: '地点轴/国籍', name: '国籍' };
const BUNDLE: TagFactsBundle = {
  roles: [GUO],
  facts: [
    { tagId: 1, roles: [GUO], carried: ['地点轴/国籍/日本'] },
    { tagId: 99, roles: [], carried: ['地点轴/国籍/美国'] },
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
  listTagRoles.mockReset();
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
    expect(listTagRoles).not.toHaveBeenCalled();
    expect(listTagCarries).not.toHaveBeenCalled();
  });

  it('只保留可见标签;认领角色剥 md;携带目标换算成「角色 -> 值」', async () => {
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect([...facts.keys()]).toEqual([1]);
    expect(facts.get(1)?.roles).toEqual([{ tagId: 7, name: '国籍' }]);
    expect(facts.get(1)?.carry).toEqual([{ role: '国籍', value: '日本' }]);
  });

  it('读数失败回空值且不抛', async () => {
    listTagFacts.mockRejectedValueOnce(new Error('boom'));
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(facts.size).toBe(0);
  });
});

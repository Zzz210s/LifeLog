// @vitest-environment jsdom
/**
 * 「关系建议」面板(设计 §9 / R6 / R11):
 *   未确认前库里零写入、依据文案可见、分页与按目标筛选、忽略的不写、
 *   确认后只建立被接受的关系、已建立过的 (标签,目标) 不再出现。
 * 全部走 mock api:不碰真实库(真实库只读)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelationRef, TagCount } from '../../shared/types';

const api = vi.hoisted(() => ({
  listTags: vi.fn<() => Promise<TagCount[]>>(),
  listTagRelations: vi.fn<(id: number) => Promise<RelationRef[]>>(),
  setTagRelation: vi.fn<(from: number, to: number) => Promise<void>>(),
}));
vi.mock('../../shared/api', () => ({ api }));

import { RelationSuggestionsSection } from './RelationSuggestionsSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tag = (id: number, path: string): TagCount => ({
  id,
  path,
  depth: path.split('/').length,
  sort_order: id,
  self_count: 0,
  subtree_count: 0,
});

/** 25 个地点标签 + 作者/年份/状态各 1 个 = 28 条建议(跨 2 页) */
const placeTags = Array.from({ length: 25 }, (_, i) => tag(100 + i, `地点/城市${String(i + 1).padStart(2, '0')}`));
const TAGS: TagCount[] = [
  tag(11, '地点轴/所在'),
  tag(20, '作者'),
  tag(31, '时间/出版年份'),
  tag(40, '状态'),
  ...placeTags,
  tag(21, '作者/甲'),
  tag(32, '时间/出版年份/1930'),
  tag(41, '状态/已完成'),
];

const edge = (toTagId: number, name: string): RelationRef => ({
  toTagId,
  path: name,
  name,
  remark: '',
});

let root: Root | null = null;
let host: HTMLDivElement;
let existing: Map<number, RelationRef[]>;

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  existing = new Map();
  api.listTags.mockResolvedValue(TAGS);
  api.listTagRelations.mockImplementation((id) => Promise.resolve(existing.get(id) ?? []));
  api.setTagRelation.mockResolvedValue();
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  vi.clearAllMocks();
});

const render = async (): Promise<void> => {
  await act(async () => {
    root?.render(createElement(RelationSuggestionsSection));
  });
  await flush();
  await flush();
};

const button = (label: string): HTMLButtonElement => {
  const el = host.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error('未找到按钮 ' + label);
  return el as HTMLButtonElement;
};

const click = async (label: string): Promise<void> => {
  await act(async () => {
    button(label).click();
  });
  await flush();
};

/** 切「按建议关系筛选」:用到筛选的用例都走它,少铺 5 行样板 */
const setFilter = async (value: string): Promise<void> => {
  const select = host.querySelector('[aria-label="按建议关系筛选"]') as HTMLSelectElement;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
};

describe('关系建议面板', () => {
  it('未确认前零写入;每条带依据文案;首页 20 条', async () => {
    await render();
    expect(api.setTagRelation).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[data-relation-row]').length).toBe(20);
    expect(host.textContent).toContain('来自路径 地点/*');
    await click('下一页');
    expect(host.textContent).toContain('时间/出版年份 下的四位年份');
    expect(host.textContent).toContain('来自路径 状态/*');
  });

  it('分页:第二页剩 8 条;上一页/下一页可用', async () => {
    await render();
    await click('下一页');
    expect(host.querySelectorAll('[data-relation-row]').length).toBe(8);
    await click('上一页');
    expect(host.querySelectorAll('[data-relation-row]').length).toBe(20);
  });

  it('按建议关系筛选后只剩该目标的建议', async () => {
    await render();
    await setFilter('20');
    const rows = [...host.querySelectorAll('[data-relation-row]')].map((r) => r.getAttribute('data-relation-row'));
    expect(rows).toEqual(['作者/甲']);
  });

  it('确认后只建立被接受的:忽略的不写,已建立的条目不写', async () => {
    await render();
    await click('忽略 作者/甲');
    expect(host.querySelector('[data-relation-row="作者/甲"]')).toBeNull();
    expect(api.setTagRelation).not.toHaveBeenCalled();
    await click('批量确认');
    expect(api.setTagRelation).toHaveBeenCalledWith(100, 11);
    expect(api.setTagRelation).not.toHaveBeenCalledWith(21, expect.anything());
    expect(api.setTagRelation).toHaveBeenCalledTimes(27);
    expect(host.textContent).toContain('已写入 27 条关系');
  });

  it('已建立过的 (标签,目标) 不再出现', async () => {
    existing.set(100, [edge(11, '地点轴/所在')]);
    await render();
    expect(host.querySelector('[data-relation-row="地点/城市01"]')).toBeNull();
    expect(host.querySelector('[data-relation-row="地点/城市02"]')).not.toBeNull();
  });

  it('全不选后批量确认不写库;全选恢复', async () => {
    await render();
    await click('全不选可见');
    await click('批量确认');
    expect(api.setTagRelation).not.toHaveBeenCalled();
    expect(host.textContent).toContain('没有选中的建议');
  });

  it('全不选可见:只圈可见项,筛选外的勾选原样保留', async () => {
    await render();
    await setFilter('20');
    await click('全不选可见');
    await setFilter('all');
    await click('批量确认');
    // 28 条建议里只圈掉了可见的 「作者/甲」(tag 21),其余 27 条照旧被写
    expect(api.setTagRelation).toHaveBeenCalledTimes(27);
    expect(api.setTagRelation).not.toHaveBeenCalledWith(21, expect.anything());
  });

  it('全选可见:只选可见项,筛选外的排除原样保留', async () => {
    await render();
    await click('全不选可见'); // 无筛选时 = 全部排除
    await setFilter('20');
    await click('全选可见'); // 只把可见的 「作者/甲」放回来
    await setFilter('all');
    await click('批量确认');
    expect(api.setTagRelation).toHaveBeenCalledTimes(1);
    expect(api.setTagRelation).toHaveBeenCalledWith(21, 20);
  });
});

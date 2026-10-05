// @vitest-environment jsdom
/**
 * 关系图右键菜单宿主的 `tagMru` 透传:图上的标签菜单与侧栏是同一个 `TagMenu`,
 * 「携带…」候选的「固定项 / 最近用过」两档必须同样来自 App 那一份实例(不能静默留空)。
 * 判别力:节点路径序把「出版年份」放在最后,不透传就上不了首位。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { GraphTagMenuHost } from './GraphTagMenuHost';

const { listTagCarries, setTagCarry, removeTagCarry, listTypes } = vi.hoisted(() => ({
  listTagCarries: vi.fn(),
  setTagCarry: vi.fn(),
  removeTagCarry: vi.fn(),
  listTypes: vi.fn(),
}));

vi.mock('../../shared/api', () => ({
  api: { listTagCarries, setTagCarry, removeTagCarry, listTypes },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (id: number, path: string): GraphNode => ({
  id,
  path,
  depth: 1,
  parent: null,
  notes: 0,
  selfCount: 0,
  sortOrder: id,
});

const NODES = [
  node(1, '携带测试甲'),
  node(2, '携带测试乙'),
  node(3, '携带测试丙'),
  node(4, '出版年份'),
];

const tagMru = {
  pinnedTags: [] as string[],
  mruTags: { entries: () => [{ id: '出版年份', count: 3 }], touch: () => {} },
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  listTagCarries.mockReset();
  listTagCarries.mockResolvedValue({ carried: [], carriersOf: [] });
  // 携带候选只列已登记类型(R3):乙/丙/出版年份
  listTypes.mockReset();
  listTypes.mockResolvedValue([
    { tagId: 2, path: '携带测试乙', name: '携带测试乙' },
    { tagId: 3, path: '携带测试丙', name: '携带测试丙' },
    { tagId: 4, path: '出版年份', name: '出版年份' },
  ]);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const candidateTexts = (): string[] =>
  [...host.querySelectorAll('[data-carry-candidate]')].map((el) => el.textContent?.trim() ?? '');

async function openCarry(mru: typeof tagMru | null): Promise<void> {
  act(() => {
    root.render(
      createElement(GraphTagMenuHost, {
        at: { id: 1, x: 10, y: 10 },
        allNodes: NODES,
        tagMru: mru,
        onClose: () => {},
        onDone: () => {},
      })
    );
  });
  const carry = [...host.querySelectorAll('[role="menuitem"]')].find(
    (b) => b.textContent?.trim() === '携带…'
  );
  if (!carry) throw new Error('图上的标签菜单没有「携带…」');
  act(() => (carry as HTMLElement).click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('GraphTagMenuHost 透传 tagMru', () => {
  it('给 tagMru 时最近用过的标签排首位', async () => {
    await openCarry(tagMru);
    expect(candidateTexts()[0]).toBe('出版年份');
  });

  it('不给时退回原路径序(证明上一条靠的就是透传)', async () => {
    await openCarry(null);
    expect(candidateTexts()[0]).toBe('携带测试乙');
  });
});

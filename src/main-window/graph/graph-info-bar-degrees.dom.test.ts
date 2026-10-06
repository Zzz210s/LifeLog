// @vitest-environment jsdom
/**
 * 信息条的出链 / 入链(L4):拉到就显示两个数,没拉到显 `–`(不编一个 0);
 * 换标签重拉(数不能是上一个标签的),失败也退成 `–`。
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../shared/types';

const { graphLinkDegrees } = vi.hoisted(() => ({
  graphLinkDegrees: vi.fn(async (): Promise<{ outbound: number; backlinks: number }> => ({ outbound: 0, backlinks: 0 })),
}));
vi.mock('../../shared/api', () => ({ api: { graphLinkDegrees } }));

import { GraphInfoBar } from './GraphInfoBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node: GraphNode = { id: 2, path: '测试/L4', depth: 2, parent: 1, notes: 2, selfCount: 2, sortOrder: 0 };
const degrees = (): string => document.querySelector('[data-testid="graph-link-degrees"]')?.textContent ?? '';

let host: HTMLDivElement;
let root: Root;

const render = async (n: GraphNode): Promise<void> => {
  await act(async () => {
    root.render(
      createElement(GraphInfoBar, { node: n, relationDegrees: { outbound: 0, backlinks: 0 }, onFilterToStream: () => {}, onToggleExpand: () => {}, expanded: false }) as ReactElement,
    );
    await Promise.resolve();
  });
};

beforeEach(() => {
  graphLinkDegrees.mockReset();
  graphLinkDegrees.mockResolvedValue({ outbound: 0, backlinks: 0 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('GraphInfoBar:出链 / 入链', () => {
  it('拉到读数就显示「出链 N / 入链 M」', async () => {
    graphLinkDegrees.mockResolvedValue({ outbound: 5, backlinks: 2 });
    await render(node);
    expect(graphLinkDegrees).toHaveBeenCalledWith(2);
    expect(degrees().replace(/\s+/g, ' ').trim()).toBe('出链 5 / 入链 2');
  });

  it('还没回包时显 `–`(不编一个 0)', async () => {
    graphLinkDegrees.mockImplementation(() => new Promise(() => {})); // 永不回包
    await render(node);
    expect(degrees().replace(/\s+/g, ' ').trim()).toBe('出链 – / 入链 –');
  });

  it('换标签重拉,且先把上一个标签的数归零(不留残数)', async () => {
    graphLinkDegrees.mockResolvedValue({ outbound: 5, backlinks: 2 });
    await render(node);
    expect(degrees()).toContain('出链 5');
    graphLinkDegrees.mockImplementation(() => new Promise(() => {})); // 新标签的回包还没来
    await render({ ...node, id: 3 });
    expect(graphLinkDegrees).toHaveBeenLastCalledWith(3);
    expect(degrees()).toContain('出链 –');
  });

  it('取数失败退成 `–`,不抛', async () => {
    graphLinkDegrees.mockRejectedValue(new Error('查询炸了'));
    await render(node);
    expect(degrees()).toContain('出链 –');
  });
});

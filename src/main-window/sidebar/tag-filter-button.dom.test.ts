// @vitest-environment jsdom
/**
 * 侧栏「筛选标签」按钮(2026-09-24 统一输入框 2/3 Task 4)的证据:
 * 按钮不再自带输入框(侧栏里 0 个 input,点了也不会冒出来),点击 = 把 `#` 交给统一输入框的
 * `prefill` 通道(与快捷键同一条);标签树不再按关键词过滤,全量行都在。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import { Sidebar } from './Sidebar';
import type { SidebarStateApi } from './use-sidebar-state';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** n 条扁平标签(无层级):侧栏行数 == 标签数,便于直接数行 */
const tagRows = (n: number): TagCount[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    path: `标签${i + 1}`,
    depth: 1,
    sort_order: 0,
    self_count: 1,
    subtree_count: 1,
  }));

const stateStub = (): SidebarStateApi => ({
  visible: true,
  setVisible: () => {},
  width: 240,
  setWidth: () => {},
  mode: 'tree',
  setMode: () => {},
});

let host: HTMLDivElement;
let root: Root;

async function render(onPrefill: (prefix: string) => void, rows: TagCount[] = tagRows(3)): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        sidebar: stateStub(),
        conditions: EMPTY_FILTER,
        onPatch: () => {},
        tagRows: rows,
        onTagsMutated: () => {},
        onPrefill,
      }),
    ),
  );
}

/** 按文本找按钮:文案就是它的可见语义,类名/结构变了也不该破坏这条断言 */
const buttonByText = (text: string): HTMLElement => {
  const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!btn) throw new Error(`侧栏没有文案为「${text}」的按钮`);
  return btn;
};

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('侧栏「筛选标签」按钮', () => {
  it('侧栏里 0 个 input,点按钮也不冒出输入框', async () => {
    await render(() => {});
    expect(host.querySelectorAll('aside input').length).toBe(0);
    await act(async () => buttonByText('筛选标签').click());
    expect(host.querySelectorAll('aside input').length).toBe(0);
  });

  it('点击把 `#` 交给统一输入框的 prefill(只调一次)', async () => {
    const prefill = vi.fn();
    await render(prefill);
    await act(async () => buttonByText('筛选标签').click());
    expect(prefill.mock.calls).toEqual([['#']]);
  });

  it('762 个标签全量渲染,不按关键词过滤', async () => {
    await render(() => {}, tagRows(762));
    expect(host.querySelectorAll('[data-tag-path]').length).toBe(762);
  });
});

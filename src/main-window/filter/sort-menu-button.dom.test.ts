// @vitest-environment jsdom
/**
 * 条件栏排序入口(2026-10-07):原先顶栏 `⋯` 的「最新在前 / 最早在前」两条快捷项删掉后,
 * 鼠标入口收敛到条件栏这一个图标按钮,点开复用既有 SortPanel(多条件排序)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { SortMenuButton } from './SortMenuButton';

vi.mock('../../shared/api', () => ({ api: { listTags: () => Promise.resolve([]) } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (conditions: FilterConditions = EMPTY_FILTER): void => {
  act(() => root.render(createElement(SortMenuButton, { conditions, onPatch: () => {} })));
};
const trigger = (): HTMLButtonElement => host.querySelector('[aria-label="排序"]') as HTMLButtonElement;
const menu = (): HTMLElement | null => host.querySelector('[data-testid="sort-menu"]');

describe('条件栏排序入口', () => {
  it('图标按钮 aria-label/title = 排序,初始不渲染浮层', () => {
    render();
    expect(trigger()).not.toBeNull();
    expect(trigger().getAttribute('title')).toBe('排序');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().textContent).toBe('');
    expect(menu()).toBeNull();
  });

  it('点开渲染 SortPanel(多条件排序,与添加条件浮层同一组件)', () => {
    render();
    act(() => trigger().click());
    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="sort-panel"]')).not.toBeNull();
  });

  it('Esc 关闭;点浮层外关闭', () => {
    render();
    act(() => trigger().click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(menu()).toBeNull();
    act(() => trigger().click());
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * 顶栏常驻「关系图」入口(2026-10-06 用户口径):在 `⋯` 溢出菜单按钮**旁边**放一个图标按钮,
 * 悬停提示「关系图」,点击走 `graph.open` 同一条命令通道(回调由 App 注入)。
 * 它与 `⋯` 同一显隐口径(只在信息流视图出现),键盘可达靠原生 button + aria-label。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';
import type { TopBarProps } from './TopBar';

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

const bar = (over: Partial<TopBarProps> = {}): ReturnType<typeof createElement> =>
  createElement(TopBar, {
    view: 'stream',
    sidebarVisible: true,
    menuItems: [],
    exporting: false,
    exported: false,
    onToggleSidebar: () => {},
    onOpenSettings: () => {},
    onBack: () => {},
    ...over,
  });

const render = (el: ReturnType<typeof createElement>): void => {
  act(() => root.render(el));
};

describe('顶栏:常驻关系图入口', () => {
  it('⋯ 旁边有一个图标按钮:aria-label/title = 关系图,点击回调一次', () => {
    const onOpenGraph = vi.fn();
    render(bar({ onOpenGraph }));
    const trigger = host.querySelector('[aria-label="更多操作"]') as HTMLElement;
    const btn = host.querySelector('[aria-label="关系图"]') as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('title')).toBe('关系图');
    // 紧挨在 ⋯ 菜单容器之后(同一行右起第二)
    expect(trigger.parentElement?.nextElementSibling).toBe(btn);
    act(() => btn.click());
    expect(onOpenGraph).toHaveBeenCalledTimes(1);
  });

  it('设置页视图不出该按钮(与 ⋯ 菜单同一显隐口径)', () => {
    render(bar({ view: 'settings', onOpenGraph: vi.fn() }));
    expect(host.querySelector('[aria-label="关系图"]')).toBeNull();
  });
});

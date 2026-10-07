// @vitest-environment jsdom
/**
 * 顶栏导出反馈 + 顶栏收敛回归(2026-10-07 盘点报告):
 * `⋯` 溢出菜单已删(条目各回视图内工具条或命令面板),ExportNotice 仍在顶栏;
 * 顶栏只剩左侧布局控制与右侧视图导航组。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExportNotice } from './ExportNotice';
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

const render = (el: ReturnType<typeof createElement>): void => {
  act(() => root.render(el));
};

const bar = (over: Partial<TopBarProps> = {}): ReturnType<typeof createElement> =>
  createElement(TopBar, {
    view: 'stream',
    sidebarVisible: true,
    exporting: false,
    exported: false,
    onToggleSidebar: () => {},
    onOpenSettings: () => {},
    onOpenGraph: () => {},
    onBack: () => {},
    ...over,
  });

describe('导出反馈:菜单外的顶栏提示', () => {
  it('既不在导出也没导出成功时不渲染', () => {
    render(createElement(ExportNotice, { exporting: false, exported: false }));
    expect(host.textContent).toBe('');
  });

  it('导出中给「正在导出…」,成功后给「已导出」', () => {
    render(createElement(ExportNotice, { exporting: true, exported: false }));
    expect(host.textContent).toBe('正在导出…');
    render(createElement(ExportNotice, { exporting: false, exported: true }));
    expect(host.textContent).toBe('已导出');
  });

  it('App 的 exporting/exported 经 TopBar 真透到提示上(两态都渲染得出)', () => {
    render(bar({ exporting: true, exported: false }));
    expect(host.textContent).toContain('正在导出…');
    render(bar({ exporting: false, exported: true }));
    expect(host.textContent).toContain('已导出');
    render(bar({ exporting: false, exported: false }));
    expect(host.textContent).not.toContain('导出');
  });
});

describe('顶栏收敛:⋯ 已删,只剩布局控制 + 视图导航', () => {
  it('信息流视图里没有「更多操作」按钮,也没有 topbar-menu 浮层', () => {
    render(bar());
    expect(host.querySelector('[aria-label="更多操作"]')).toBeNull();
    expect(host.querySelector('[data-testid="topbar-menu"]')).toBeNull();
  });

  it('信息流视图:左侧侧栏开关常驻,右侧视图导航组三项都在', () => {
    render(bar({ view: 'stream' }));
    expect(host.querySelector('[aria-label="隐藏侧栏"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="view-nav"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="信息流"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="关系图"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="设置"]')).not.toBeNull();
  });

  it('设置与关系图视图里导航组仍在(不再有「返回信息流」文字按钮)', () => {
    for (const view of ['settings', 'graph'] as const) {
      render(bar({ view }));
      expect(host.textContent).not.toContain('返回信息流');
      expect(host.querySelector('[data-testid="view-nav"]')).not.toBeNull();
    }
  });
});

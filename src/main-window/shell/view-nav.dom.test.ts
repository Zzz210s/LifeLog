// @vitest-environment jsdom
/**
 * 顶栏视图导航组(2026-10-07 盘点报告):信息流 / 关系图 / 设置 三个图标挨在一起,
 * 当前视图用 aria-current="page" 高亮;导航组里的「信息流」就是返回动作(不再另放箭头/文字按钮)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewNav } from './ViewNav';
import type { ViewNavProps } from './ViewNav';

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

const render = (over: Partial<ViewNavProps> = {}): void => {
  act(() =>
    root.render(
      createElement(ViewNav, {
        view: 'stream',
        onOpenStream: () => {},
        onOpenGraph: () => {},
        onOpenSettings: () => {},
        ...over,
      })
    )
  );
};

const buttons = (): HTMLButtonElement[] =>
  [...host.querySelectorAll('button')] as HTMLButtonElement[];
const byLabel = (label: string): HTMLButtonElement =>
  host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;

describe('顶栏视图导航组', () => {
  it('三个图标按钮,顺序 信息流 / 关系图 / 设置,都只有图标没有文字', () => {
    render();
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual(['信息流', '关系图', '设置']);
    expect(buttons().map((b) => b.getAttribute('title'))).toEqual(['信息流', '关系图', '设置']);
    for (const b of buttons()) {
      expect(b.textContent).toBe('');
      expect(b.querySelector('svg')).not.toBeNull();
    }
    expect(host.querySelector('[aria-label="视图导航"]')).not.toBeNull();
  });

  it('当前视图高亮:aria-current=page + bg-selected,其余不带', () => {
    render({ view: 'graph' });
    expect(byLabel('关系图').getAttribute('aria-current')).toBe('page');
    expect(String(byLabel('关系图').className)).toContain('bg-selected');
    expect(byLabel('信息流').getAttribute('aria-current')).toBeNull();
    expect(String(byLabel('信息流').className)).not.toContain('bg-selected');
    expect(byLabel('设置').getAttribute('aria-current')).toBeNull();
  });

  it('每个视图都能高亮自己(设置页时高亮在设置上)', () => {
    render({ view: 'settings' });
    expect(byLabel('设置').getAttribute('aria-current')).toBe('page');
    expect(byLabel('信息流').getAttribute('aria-current')).toBeNull();
  });

  it('三条入口各自回调一次', () => {
    const onOpenStream = vi.fn();
    const onOpenGraph = vi.fn();
    const onOpenSettings = vi.fn();
    render({ onOpenStream, onOpenGraph, onOpenSettings });
    act(() => byLabel('信息流').click());
    act(() => byLabel('关系图').click());
    act(() => byLabel('设置').click());
    expect(onOpenStream).toHaveBeenCalledTimes(1);
    expect(onOpenGraph).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

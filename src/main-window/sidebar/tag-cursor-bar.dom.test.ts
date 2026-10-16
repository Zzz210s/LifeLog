// @vitest-environment jsdom
/**
 * select 模式的底部光标条(设计 2026-10-16 §5.3):显示当前光标实体的路径与两个计数,
 * 并提供「只看这条实体」与「清除选中」两个入口。纯 props 驱动,是否渲染由上层决定。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TagCursorBar } from './TagCursorBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let onlyCalls: number;
let clearCalls: number;

beforeEach(() => {
  onlyCalls = 0;
  clearCalls = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (path = '读书/技术', self = 3, subtree = 12): Promise<void> => {
  await act(async () =>
    root.render(
      createElement(TagCursorBar, {
        path,
        selfCount: self,
        subtreeCount: subtree,
        onOnlyThis: () => {
          onlyCalls += 1;
        },
        onClear: () => {
          clearCalls += 1;
        },
      })
    )
  );
};

const byLabel = (label: string): HTMLButtonElement =>
  host.querySelector('button[aria-label="' + label + '"]') as HTMLButtonElement;

describe('侧栏:select 模式的光标条', () => {
  it('锚点与文本:data-testid=tag-cursor-bar,显示路径与本级/含子级两个计数', async () => {
    await render('读书/技术', 3, 12);
    const bar = host.querySelector('[data-testid="tag-cursor-bar"]');
    expect(bar).not.toBeNull();
    const text = bar!.textContent ?? '';
    expect(text).toContain('实体：');
    expect(text).toContain('读书/技术');
    expect(text).toContain('本级 3');
    expect(text).toContain('含子级 12');
  });

  it('「只看这条实体」与「清除选中」各回调一次', async () => {
    await render();
    await act(async () => byLabel('只看这条实体').click());
    expect(onlyCalls).toBe(1);
    expect(clearCalls).toBe(0);
    await act(async () => byLabel('清除选中').click());
    expect(clearCalls).toBe(1);
    expect(onlyCalls).toBe(1);
  });

  it('计数为 0 时照常显示读数(不隐藏、不改口径)', async () => {
    await render('空容器', 0, 0);
    const text = host.querySelector('[data-testid="tag-cursor-bar"]')!.textContent ?? '';
    expect(text).toContain('本级 0');
    expect(text).toContain('含子级 0');
  });
});

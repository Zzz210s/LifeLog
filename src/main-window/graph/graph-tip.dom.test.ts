// @vitest-environment jsdom
/**
 * 画布气泡(G2 Task 4):`GraphTip` 只是 `TipBubble` 的一层文案包装,故这里钉两件事 ——
 * 无节点时一个气泡都不渲染,TipBubble 的 `x/y` 契约是屏幕坐标(Task 5 换算相机后照此传)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { GraphTip } from './GraphTip';
import { TipBubble } from '../shell/TipBubble';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node: GraphNode = {
  id: 7,
  path: '时间/日期/2026',
  depth: 3,
  parent: 3,
  notes: 120,
  selfCount: 9,
  sortOrder: 2,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

const render = async (el: React.ReactElement): Promise<void> => {
  await act(async () => {
    root.render(el);
  });
};

const tip = (): HTMLElement | null => host.querySelector('[data-testid="hover-tip"]');

describe('GraphTip:悬停气泡的文案与坐标', () => {
  it('没有节点时什么都不渲染', async () => {
    await render(createElement(GraphTip, { node: null, x: 10, y: 20 }));
    expect(tip()).toBeNull();
    expect(host.textContent).toBe('');
  });

  it('文案是「路径 · 本级 N / 含子级 M」', async () => {
    await render(createElement(GraphTip, { node, x: 10, y: 20 }));
    expect(tip()?.textContent).toBe('时间/日期/2026 · 本级 9 / 含子级 120');
  });

  it('复用悬浮气泡的外观(同一 testid,不吃指针)', async () => {
    await render(createElement(GraphTip, { node, x: 10, y: 20 }));
    const el = tip();
    expect(el?.className).toContain('pointer-events-none');
    expect(el?.className).toContain('fixed');
  });

  it('坐标按屏幕口径:默认贴锚点下方,above 贴上方', async () => {
    await render(createElement(GraphTip, { node, x: 30, y: 40 }));
    expect(tip()?.style.left).toBe('30px');
    expect(tip()?.style.top).toBe('46px');
    const inner = window.innerHeight;
    await render(createElement(TipBubble, { text: 'x', x: 30, y: 40, above: true }));
    expect(tip()?.style.bottom).toBe(`${inner - 40 + 6}px`);
    expect(tip()?.style.top).toBe('');
  });
});

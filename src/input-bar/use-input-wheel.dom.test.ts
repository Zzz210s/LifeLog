/**
 * 输入栏滚轮缩放的接线测试:普通滚轮改缩放、Ctrl+滚轮改透明度、中键恢复。
 *
 * 守的是 2026-09-25 验收抓到的真问题:滚轮处理器里"落点是否在可滚容器内"的判定用
 * `getComputedStyle(e.target)`,而**合成事件**(验收脚本、程序化派发)的 target 可能是
 * `window`/`document` —— Chromium 下 `getComputedStyle(window)` 抛 TypeError,把整个处理器
 * 打断,缩放静默失效(实测:验收 I4 从"生效"变成"zoom 不变")。
 *
 * jsdom 也会抛同一个 TypeError(它按规范走 `Element.convert`,document/window 都不是 Element),
 * 所以这条用例对 guard 本身也有判别力:删掉 `use-input-wheel.ts` 里的 `instanceof Element`
 * 那一行,它会立刻变红(实测)。它同时钉住契约:合成事件(非元素 target)落在 window/document 上
 * 时缩放仍要生效 —— 谁再加一句"target 不是元素就 return"也会让它变红。
 */
// @vitest-environment jsdom
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INPUT_DEFAULTS } from '../shared/input-settings';
import { useInputWheel } from './use-input-wheel';

const { getSetting, setSetting, setInputScale, setInputSize, setInputHeight, setInputHeightOverlay, hideInputBar } =
  vi.hoisted(() => ({
    getSetting: vi.fn(async () => null),
    setSetting: vi.fn(async (_k: string, _v: string) => undefined),
    setInputScale: vi.fn(async () => undefined),
    setInputSize: vi.fn(async () => undefined),
    setInputHeight: vi.fn(async () => undefined),
    setInputHeightOverlay: vi.fn(async () => undefined),
    hideInputBar: vi.fn(async () => undefined),
  }));
// jsdom 里没有 Tauri 运行时:焦点订阅走桩,本用例只关心滚轮分支
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));
vi.mock('../shared/api', () => ({
  api: { getSetting, setSetting, setInputScale, setInputSize, setInputHeight, setInputHeightOverlay, hideInputBar },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const fn of [getSetting, setSetting, setInputScale, setInputSize, setInputHeight, setInputHeightOverlay, hideInputBar]) fn.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

function Harness(): ReactNode {
  // 只挂 hook:本文件测的是 window 上的 wheel 接线,中键那条路径由 CDP 读数 I6 覆盖
  useInputWheel({ settings: INPUT_DEFAULTS, onResized: () => {}, onError: () => {} });
  return null;
}

/** 缩放落库走 setSetting('input_zoom', ...),这里只关心"有没有被调" */
const zoomWrites = () => setSetting.mock.calls.filter((c) => c[0] === 'input_zoom').length;

describe('输入栏滚轮接线', () => {
  it('普通滚轮(非元素 target 的合成事件)不抛错,仍走缩放', async () => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      document.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    });
    expect(setInputScale).toHaveBeenCalled(); // 缩放真的生效(修复前这里恒 0 次)
  });

  it('Ctrl+滚轮走透明度,不动缩放', async () => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      document.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(setInputScale).not.toHaveBeenCalled();
    expect(zoomWrites()).toBe(0);
  });
});

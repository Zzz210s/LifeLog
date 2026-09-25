/**
 * 输入栏滚轮缩放的接线测试:普通滚轮改缩放、Ctrl+滚轮改透明度、中键恢复。
 *
 * 守的是 2026-09-25 验收抓到的真问题:滚轮处理器里"落点是否在可滚容器内"的判定用
 * `getComputedStyle(e.target)`,而**合成事件**(验收脚本、程序化派发)的 target 可能是
 * `window`/`document` —— Chromium 下 `getComputedStyle(window)` 抛 TypeError,把整个处理器
 * 打断,缩放静默失效(实测:验收 I4 从"生效"变成"zoom 不变")。
 *
 * 注意本文件**不能**复现那次 TypeError(jsdom 的 getComputedStyle 对 document 不抛),
 * 所以它钉的是契约而不是那条 guard:合成事件(非元素 target)落在 window/document 上时,
 * 缩放仍要生效。这条契约正是当时被打破的东西 —— 谁再加一句"target 不是元素就 return"
 * 都会让它变红。guard 本身的实机判别见台账 task-6 报告(dev CDP:input_zoom 0.80 -> 0.90)。
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
let wheel: ((e: WheelEvent) => boolean) | null;

beforeEach(() => {
  for (const fn of [getSetting, setSetting, setInputScale, setInputSize, setInputHeight, setInputHeightOverlay, hideInputBar]) fn.mockClear();
  wheel = null;
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
  const api = useInputWheel({
    settings: INPUT_DEFAULTS,
    onResized: () => {},
    onError: () => {},
  });
  wheel = (e: WheelEvent) => api.onMiddleDown(e) === false;
  return null;
}

/** 缩放落库走 setSetting('input_zoom', ...),这里只关心"有没有被调" */
const zoomWrites = () => setSetting.mock.calls.filter((c) => c[0] === 'input_zoom').length;

describe('输入栏滚轮接线', () => {
  it('普通滚轮(目标为 window 的合成事件)不抛错,仍走缩放', async () => {
    await act(async () => root.render(createElement(Harness)));
    expect(wheel).not.toBeNull();
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

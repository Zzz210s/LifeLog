/**
 * 自动高度与「最小高度」下限的关系:有效高度 = max(自动高度, 下限)。
 *
 * 三条契约:
 * ① 下限为 0(缺省)时走**既有的** setInputHeight(input_h 的写入路径不变);
 * ② 内容比下限矮时窗口保留下限,且走不落库的 overlay(下限高度不是内容高度,
 *    写进 input_h 会造出悬空空高条 —— 与建议列表展开同一条理由);
 * ③ 内容比下限高时照常随内容长高(把 max 写成「直接用下限」这条 сразу 变红)。
 */
// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoHeight } from './use-auto-height';

/** 当前窗口逻辑高(基础逻辑高 x ratio);自动高度只在「与当前窗口高差 > 1」时才发命令 */
const state = vi.hoisted(() => ({ ratio: 1, height: 30, scrollH: 0 }));
const calls = vi.hoisted(() => ({
  setInputHeight: vi.fn(async () => undefined),
  setInputHeightOverlay: vi.fn(async () => undefined),
}));

vi.mock('../shared/api', () => ({
  api: { setInputHeight: calls.setInputHeight, setInputHeightOverlay: calls.setInputHeightOverlay },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ isVisible: async () => true, listen: async () => () => {} }),
}));
vi.mock('./logical-size', () => ({
  readGeometry: async () => ({
    width: 480,
    height: state.height,
    scale: 1,
    x: 0,
    y: 0,
    ratio: state.ratio,
  }),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** border 显式归零:jsdom 的默认样式表给 textarea 挂了 16px 边框(真机由 Tailwind preflight 归零) */
const TEXT_STYLE = {
  lineHeight: '22.75px',
  paddingTop: '9px',
  paddingBottom: '9px',
  border: '0px solid transparent',
};
const PAD_Y = 18;
const LINE = 22.75;
/** 与真机同源的算式:ceil(行高 x 行数 + 内边距 + 边框 + 光晕环 2 x 14) */
const heightOf = (lines: number) => Math.ceil(lines * LINE + PAD_Y + 28);

let host: HTMLDivElement;
let root: Root;

function Harness({ minHeight, lines }: { minHeight: number; lines: number }): ReactNode {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  useAutoHeight({ textareaRef: ta, value: '内容', extraCss: 0, minHeight });
  return createElement('textarea', {
    ref: (el: HTMLTextAreaElement | null) => {
      ta.current = el;
      // jsdom 不做排版:按行数打桩 scrollHeight(含上下内边距,与 windowHeightFor 的算法一致)
      if (el) Object.defineProperty(el, 'scrollHeight', { get: () => lines * LINE + PAD_Y, configurable: true });
    },
    style: TEXT_STYLE,
    readOnly: true,
  });
}

async function mount(minHeight: number, lines: number): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { minHeight, lines }));
  });
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  state.ratio = 1;
  state.height = 30;
  for (const fn of [calls.setInputHeight, calls.setInputHeightOverlay]) fn.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('useAutoHeight x 最小高度下限', () => {
  it('下限缺省(0):走既有的 setInputHeight,按 1 行内容定高', async () => {
    await mount(0, 1);
    expect(calls.setInputHeight).toHaveBeenCalledTimes(1);
    expect(calls.setInputHeight).toHaveBeenCalledWith(heightOf(1));
    expect(calls.setInputHeightOverlay).not.toHaveBeenCalled();
  });

  it('内容比下限矮:窗口保留下限,且不落库(input_h 不被写成下限)', async () => {
    await mount(200, 1);
    expect(calls.setInputHeightOverlay).toHaveBeenCalledWith(200);
    expect(calls.setInputHeight).not.toHaveBeenCalled();
  });

  it('内容比下限高:仍随内容长高(有效高度 = max(自动, 下限))', async () => {
    await mount(heightOf(1), 3);
    expect(calls.setInputHeight).toHaveBeenCalledWith(heightOf(3));
    expect(calls.setInputHeightOverlay).not.toHaveBeenCalled();
  });

  it('下限变化后重算:拖高下限时窗口跟着长,拖回 0 时缩回自动高度', async () => {
    await mount(200, 1);
    await act(async () => {
      root.render(createElement(Harness, { minHeight: 260, lines: 1 }));
    });
    await act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(calls.setInputHeightOverlay).toHaveBeenLastCalledWith(260);
    await act(async () => {
      root.render(createElement(Harness, { minHeight: 0, lines: 1 }));
    });
    await act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(calls.setInputHeight).toHaveBeenLastCalledWith(heightOf(1)); // 回到纯自动
  });
});

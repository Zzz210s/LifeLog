// @vitest-environment jsdom
/**
 * 输入栏的首次使用入口(计划 Task 3):挂载时读 `ui.tutorial_seen`,**未看过**才请求打开主窗
 * (主窗是引导的承载界面;输入栏自己只是独立贴纸窗,盖不上那层覆盖)。已看过什么都不做。
 * 夹具是**真 hook**(InputBar 挂载时原样调用它),只有 IPC 走 mock。
 *
 * 为什么不渲染整个 InputBar:输入栏依赖 Tauri 的窗口/事件 API(innerSize / scaleFactor /
 * onFocusChanged / listen),渲染它需要把这些全部替换成假实现 —— 那验证的就不是真实路径了
 * (与 Task 2 报告里不用 @testing-library 的同一条理由)。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTutorialOpenRequest } from './use-tutorial-open-request';

const h = vi.hoisted(() => ({
  /** ui.tutorial_seen 的库值 */
  seen: null as string | null,
  fail: false,
  openMainWindow: vi.fn(),
}));

vi.mock('../shared/api', () => ({
  api: {
    getSetting: (key: string) => {
      if (key !== 'ui.tutorial_seen') return Promise.resolve(null);
      return h.fail ? Promise.reject('读取失败') : Promise.resolve(h.seen);
    },
    openMainWindow: h.openMainWindow,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness(): ReactNode {
  useTutorialOpenRequest();
  return null;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  h.seen = null;
  h.fail = false;
  h.openMainWindow.mockReset();
  h.openMainWindow.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const mount = (): void => act(() => root.render(createElement(Harness)));

describe('输入栏的首次使用入口', () => {
  it('未看过引导(无标记):挂载后请求打开主窗一次', async () => {
    mount();
    await flush();
    expect(h.openMainWindow).toHaveBeenCalledTimes(1);
  });

  it('空串也算未看过:请求打开主窗(「清标记重看」不必删行)', async () => {
    h.seen = '';
    mount();
    await flush();
    expect(h.openMainWindow).toHaveBeenCalledTimes(1);
  });

  it('已看过("1"):不请求', async () => {
    h.seen = '1';
    mount();
    await flush();
    expect(h.openMainWindow).not.toHaveBeenCalled();
  });

  it('读设置失败:不请求也不抛错(输入栏照常可用)', async () => {
    h.fail = true;
    mount();
    await flush();
    expect(h.openMainWindow).not.toHaveBeenCalled();
  });
});

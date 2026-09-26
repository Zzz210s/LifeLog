// @vitest-environment jsdom
/**
 * 引导期间临时收起输入栏的接线测试:可见才收、结束时按原状恢复、失败静默。
 * 只 mock IPC,挂真 hook。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTutorialInputBar } from './use-tutorial-input-bar';

const h = vi.hoisted(() => ({
  visible: true as boolean,
  inputBarVisible: vi.fn(),
  hideInputBar: vi.fn(),
  showInputWindow: vi.fn(),
}));
vi.mock('../../shared/api', () => ({
  api: {
    inputBarVisible: h.inputBarVisible,
    hideInputBar: h.hideInputBar,
    showInputWindow: h.showInputWindow,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

function Harness({ open }: { open: boolean }): ReactNode {
  useTutorialInputBar(open);
  return null;
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  h.visible = true;
  h.inputBarVisible.mockReset().mockImplementation(async () => h.visible);
  h.hideInputBar.mockReset().mockResolvedValue(undefined);
  h.showInputWindow.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('引导期间的输入栏收起', () => {
  it('引导开:可见则收起;引导关:按原状恢复显示', async () => {
    await act(async () => root.render(createElement(Harness, { open: true })));
    await flush();
    expect(h.inputBarVisible).toHaveBeenCalledTimes(1);
    expect(h.hideInputBar).toHaveBeenCalledTimes(1);
    expect(h.showInputWindow).not.toHaveBeenCalled();

    await act(async () => root.render(createElement(Harness, { open: false })));
    await flush();
    expect(h.showInputWindow).toHaveBeenCalledTimes(1); // 原本可见 -> 恢复
  });

  it('引导开时输入栏本就不可见:不收起,结束时也不恢复', async () => {
    h.visible = false;
    await act(async () => root.render(createElement(Harness, { open: true })));
    await flush();
    expect(h.hideInputBar).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Harness, { open: false })));
    await flush();
    expect(h.showInputWindow).not.toHaveBeenCalled();
  });

  it('问询/收起/恢复失败都静默(不抛、不重复调用)', async () => {
    h.inputBarVisible.mockRejectedValueOnce(new Error('boom'));
    await act(async () => root.render(createElement(Harness, { open: true })));
    await flush();
    expect(h.hideInputBar).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Harness, { open: false })));
    await flush();
    expect(h.showInputWindow).not.toHaveBeenCalled(); // 没确认过可见性就不擅自显示

    h.visible = true;
    h.showInputWindow.mockRejectedValueOnce(new Error('boom'));
    await act(async () => root.render(createElement(Harness, { open: true })));
    await flush();
    await act(async () => root.render(createElement(Harness, { open: false })));
    await flush();
    expect(h.showInputWindow).toHaveBeenCalledTimes(1); // 恢复尝试了,失败不影响其它
  });
});

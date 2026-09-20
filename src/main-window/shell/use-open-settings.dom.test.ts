// 这一组用例用真实 React 渲染 + 假的事件订阅/API,证明「事件到达时消费 pending」这条不变量
// 真的挂在 useOpenSettings 的 listen 回调上 —— 只测 consumePendingAfterEvent 本身是自证式的,
// 把 hook 里那两行删掉也照样绿(2026-09-21 复审 Important 3)。
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listeners: Array<{ event: string; handler: () => void }> = [];
const takePending = vi.fn();
const opened = { n: 0 };

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: () => void) => {
    listeners.push({ event, handler });
    return Promise.resolve(() => undefined);
  },
}));
vi.mock('../../shared/api', () => ({
  api: { takePendingOpenSettings: () => takePending() },
}));

const { useOpenSettings } = await import('./use-open-settings');

function Probe() {
  useOpenSettings(() => {
    opened.n += 1;
  });
  return null;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(Probe));
  });
}

beforeEach(() => {
  listeners.length = 0;
  takePending.mockReset();
  opened.n = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useOpenSettings 的两路意图通道', () => {
  it('mount 取用 pending;事件到达时再消费一次(不留残留)', async () => {
    takePending.mockResolvedValue(true);
    await mount();
    expect(opened.n).toBe(1); // 通道②:mount 取到 pending -> 切设置页
    expect(takePending).toHaveBeenCalledTimes(1);
    const subs = listeners.filter((l) => l.event === 'open-settings');
    expect(subs.length).toBeGreaterThan(0);

    await act(async () => {
      subs[0].handler();
    });
    // 通道①:事件回调里必须**也**取用一次 —— 删掉 hook 里那行,这一步就不成立
    expect(takePending).toHaveBeenCalledTimes(2);
    expect(opened.n).toBe(2);
  });

  it('mount 时 pending 为 false -> 停在信息流,不切页', async () => {
    takePending.mockResolvedValue(false);
    await mount();
    expect(opened.n).toBe(0);
  });

  it('mount 与事件两条通道都不抛异常,取用失败也不影响切页', async () => {
    takePending.mockResolvedValueOnce(true).mockRejectedValue(new Error('IPC 失败'));
    await mount();
    const subs = listeners.filter((l) => l.event === 'open-settings');
    await act(async () => {
      subs[0]?.handler();
    });
    expect(opened.n).toBeGreaterThanOrEqual(1);
  });
});

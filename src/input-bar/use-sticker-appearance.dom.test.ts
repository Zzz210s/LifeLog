// 输入栏「读设置 -> 写 CSS 变量」的接线:
// 挂载读一次;获得焦点重读;收到 input-settings-changed 广播重读(复用既有通道,不新建事件);
// 读失败静默保持默认(= 回退主题令牌);亮暗切换换用 *_dark 那份颜色。
// @vitest-environment jsdom
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputAppearance } from '../shared/input-appearance';
import type { StickerStyle } from '../shared/sticker-style';
import { useStickerAppearance } from './use-sticker-appearance';

const { getSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_k: string): Promise<string | null> => null),
}));
vi.mock('../shared/api', () => ({ api: { getSetting } }));

const ev = vi.hoisted(() => {
  const callbacks: Array<(e: { payload: unknown }) => void> = [];
  return {
    callbacks,
    listen: vi.fn(async (_name: string, cb: (e: { payload: unknown }) => void) => {
      callbacks.push(cb);
      return () => {
        const i = callbacks.indexOf(cb);
        if (i >= 0) callbacks.splice(i, 1);
      };
    }),
  };
});
vi.mock('@tauri-apps/api/event', () => ({ listen: ev.listen }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let appearance: InputAppearance | null = null;
let vars: StickerStyle = { '--sticker-bg': '', '--sticker-border': '', '--sticker-radius': '', '--sticker-shadow': '' };

function Probe(): ReactNode {
  const got = useStickerAppearance();
  appearance = got.appearance;
  vars = got.vars;
  return createElement('span', null, got.vars['--sticker-radius']);
}

const settle = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });

function keyValue(map: Record<string, string>): (k: string) => Promise<string | null> {
  return async (k: string) => map[k] ?? null;
}

beforeEach(() => {
  getSetting.mockReset();
  getSetting.mockResolvedValue(null);
  ev.listen.mockClear();
  ev.callbacks.length = 0;
  document.documentElement.className = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  appearance = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.className = '';
});

describe('useStickerAppearance', () => {
  it('挂载时按库值算变量', async () => {
    getSetting.mockImplementation(keyValue({ input_radius: '12', input_bg: '#1f2328' }));
    await act(async () => {
      root.render(createElement(Probe));
    });
    await settle();
    expect(vars['--sticker-radius']).toBe('12px');
    expect(vars['--sticker-bg']).toBe('#1f2328');
    expect(appearance?.radius).toBe(12);
  });

  it('收到设置变更广播后重读', async () => {
    getSetting.mockResolvedValue(null);
    await act(async () => {
      root.render(createElement(Probe));
    });
    await settle();
    expect(vars['--sticker-radius']).toBe('0px');
    getSetting.mockImplementation(keyValue({ input_radius: '8' }));
    await act(async () => {
      ev.callbacks.forEach((cb) => cb({ payload: null }));
      await Promise.resolve();
    });
    await settle();
    expect(vars['--sticker-radius']).toBe('8px');
  });

  it('读失败静默保持默认且不抛', async () => {
    getSetting.mockRejectedValue(new Error('boom'));
    await act(async () => {
      root.render(createElement(Probe));
    });
    await settle();
    expect(vars['--sticker-bg']).toBe('var(--color-raised)');
    expect(vars['--sticker-border']).toBe('var(--color-border)');
  });

  it('暗色下换用 *_dark 那份颜色', async () => {
    document.documentElement.classList.add('dark');
    getSetting.mockImplementation(keyValue({ input_bg: '#111111', input_bg_dark: '#222222' }));
    await act(async () => {
      root.render(createElement(Probe));
    });
    await settle();
    expect(vars['--sticker-bg']).toBe('#222222');
  });
});

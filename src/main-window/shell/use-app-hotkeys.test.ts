/** 应用内快捷键读取/刷新的单测:挂载读一次、焦点与自定义事件各刷一次 */
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_HOTKEY_KEYS } from '../../shared/hotkey-match';
import type { AppHotkeyReading } from '../palette/use-palette-hotkeys';
import { APP_HOTKEYS_CHANGED, useAppHotkeys } from './use-app-hotkeys';

const { getSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let read: () => AppHotkeyReading;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(async () => {
  getSetting.mockImplementation(async (key: string) =>
    key === APP_HOTKEY_KEYS.palette ? 'ctrl+alt+k' : null,
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(function Host() {
        read = useAppHotkeys();
        return null;
      }),
    ),
  );
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe('useAppHotkeys:读取与刷新', () => {
  it('挂载即读两个键(缺失的那个给 null,由 effectiveAppHotkey 兜底)', () => {
    expect(getSetting).toHaveBeenCalledWith(APP_HOTKEY_KEYS.palette);
    expect(getSetting).toHaveBeenCalledWith(APP_HOTKEY_KEYS.quickOpen);
    expect(read()).toEqual({ palette: 'ctrl+alt+k', quickOpen: null });
  });

  it('窗口重新获得焦点时刷新(改完设置切回主窗即生效)', async () => {
    getSetting.mockImplementation(async () => 'ctrl+shift+j');
    act(() => window.dispatchEvent(new Event('focus')));
    await settle();
    expect(read().palette).toBe('ctrl+shift+j');
  });

  it('收到 lifelog://app-hotkeys-changed 立即刷新(录制器保存后的接缝)', async () => {
    getSetting.mockImplementation(async () => 'ctrl+alt+9');
    act(() => window.dispatchEvent(new Event(APP_HOTKEYS_CHANGED)));
    await settle();
    expect(read()).toEqual({ palette: 'ctrl+alt+9', quickOpen: 'ctrl+alt+9' });
  });

  it('读取失败不抛:缓存保持旧值(继续用默认键)', async () => {
    getSetting.mockRejectedValue(new Error('设置表坏了'));
    act(() => window.dispatchEvent(new Event('focus')));
    await settle();
    expect(read().palette).toBe('ctrl+alt+k');
  });
});

/** 浮层设置装配的单测:读一次、空闲落盘去抖、卸载兜底落盘 */
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PALETTE_SETTING_KEYS } from './palette-settings';
import { MRU_IDLE_SAVE_MS, usePaletteSettings } from './use-palette-settings';
import type { PaletteSettingsApi, SettingIo } from './use-palette-settings';
import type { PaletteSettings } from './palette-mru';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  api: () => PaletteSettingsApi;
  settings: () => PaletteSettings | null;
  unmount: () => void;
}

function mount(io: SettingIo): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const box: { v: PaletteSettingsApi | null } = { v: null };
  act(() =>
    root.render(
      createElement(function Host() {
        box.v = usePaletteSettings(io);
        return null;
      }),
    ),
  );
  return {
    api: () => box.v as PaletteSettingsApi,
    settings: () => (box.v as PaletteSettingsApi).settings,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const ioWith = (): SettingIo & { writes: string[] } => {
  const writes: string[] = [];
  return {
    writes,
    read: async (key: string) =>
      key === PALETTE_SETTING_KEYS.mruCommands ? '[{"id":"note.new","count":2}]' : null,
    write: async (key: string, value: string) => {
      writes.push(`${key}=${value}`);
    },
  };
};

let h: Harness;
let io: SettingIo & { writes: string[] };
beforeEach(async () => {
  vi.useFakeTimers();
  io = ioWith();
  h = mount(io);
  await act(async () => {
    await Promise.resolve();
  });
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('usePaletteSettings:读与落盘时机', () => {
  it('启动读回设置(MRU 计数可用,上限回缺省)', () => {
    expect(h.settings()?.mruCommands.count('note.new')).toBe(2);
    expect(h.settings()?.limit).toBe(200);
  });

  it('接受后空闲才落盘,连续接受只写一次', () => {
    h.settings()!.mruCommands.touch('note.new'); // 接受时标脏
    h.api().saveMruSoon();
    h.api().saveMruSoon();
    vi.advanceTimersByTime(MRU_IDLE_SAVE_MS - 1);
    expect(io.writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toContain('note.new');
  });

  it('卸载兜底把改动写盘(退出场景)', () => {
    h.settings()!.mruNotes.touch('42');
    h.unmount();
    expect(io.writes.some((w) => w.includes('"42"'))).toBe(true);
  });
});

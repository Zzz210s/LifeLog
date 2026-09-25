// @vitest-environment jsdom
/**
 * 应用内快捷键模型层:三个动作各写什么值、成功即广播「即时生效」事件、
 * 失败把 Rust 的中文原因原样抛出(不吞不换)。
 * 校验规则不在这里测 —— 规范化与冲突判定在 Rust(`src-tauri/src/app_hotkey.rs`)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_HOTKEY_KEYS } from '../../shared/hotkey-match';
import { APP_HOTKEYS_CHANGED } from '../shell/use-app-hotkeys';
import { appHotkeyRows, clearAppHotkey, resetAppHotkey, saveAppHotkey } from './app-hotkey-model';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ kind: string; accelerator: string }>,
  fail: null as string | null,
}));

vi.mock('../../shared/api', () => ({
  api: {
    setAppHotkey: (kind: string, accelerator: string) => {
      h.calls.push({ kind, accelerator });
      return h.fail === null ? Promise.resolve(accelerator) : Promise.reject(h.fail);
    },
  },
}));

let events = 0;
const onChanged = (): void => {
  events++;
};

beforeEach(() => {
  h.calls.length = 0;
  h.fail = null;
  events = 0;
  window.addEventListener(APP_HOTKEYS_CHANGED, onChanged);
});

afterEach(() => {
  window.removeEventListener(APP_HOTKEYS_CHANGED, onChanged);
});

describe('两行元数据', () => {
  it('键名与默认值同源(APP_HOTKEY_KEYS),录制按钮 aria-label 与全局那行不同名', () => {
    const rows = appHotkeyRows();
    expect(rows.map((r) => r.kind)).toEqual(['quickOpen', 'palette']);
    expect(rows.map((r) => r.key)).toEqual([APP_HOTKEY_KEYS.quickOpen, APP_HOTKEY_KEYS.palette]);
    const labels = rows.map((r) => r.ariaLabel);
    expect(new Set(labels).size).toBe(2);
    expect(labels).not.toContain('录制快捷键'); // 全局那行的名字留给命令 hotkey.edit 定位
    expect(rows.map((r) => r.label)).toEqual(['快速打开笔记', '命令']);
  });
});

describe('三个动作各自写什么值', () => {
  it('录制:把原始组合交给 Rust,成功返回规范化值并广播即时生效', async () => {
    await expect(saveAppHotkey('palette', 'ctrl+alt+k')).resolves.toBe('ctrl+alt+k');
    expect(h.calls).toEqual([{ kind: 'palette', accelerator: 'ctrl+alt+k' }]);
    expect(events).toBe(1);
  });

  it('清除:写空串(读取侧回退默认键)', async () => {
    await expect(clearAppHotkey('quickOpen')).resolves.toBe('');
    expect(h.calls).toEqual([{ kind: 'quickOpen', accelerator: '' }]);
    expect(events).toBe(1);
  });

  it('恢复默认:显式写回默认值(与清除的区别只在库里留什么)', async () => {
    await expect(resetAppHotkey('palette')).resolves.toBe('ctrl+shift+p');
    await expect(resetAppHotkey('quickOpen')).resolves.toBe('ctrl+p');
    expect(h.calls.map((c) => c.accelerator)).toEqual(['ctrl+shift+p', 'ctrl+p']);
    expect(events).toBe(2);
  });
});

describe('失败路径', () => {
  it('Rust 的中文原因原样抛出,且不广播(旧键保持可用)', async () => {
    h.fail = 'ctrl+p 已被「快速打开笔记」占用,请换一个组合';
    await expect(saveAppHotkey('palette', 'ctrl+p')).rejects.toBe(h.fail);
    expect(events).toBe(0);
  });
});

// @vitest-environment jsdom
/**
 * 应用内快捷键 -> 预填前缀(Task 7:命中即聚焦唯一输入框并预填,不再开关浮层)。
 * 键位与存储读取(默认值回退 / 自定义优先 / repeat 忽略)仍是 T6 的口径,只把 `onTrigger(开浮层)`
 * 换成 `onPrefill`;夹具自足(共用浮层夹具随浮层外壳一起删除)。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePaletteHotkeys } from './use-palette-hotkeys';
import type { AppHotkeyReading } from './use-palette-hotkeys';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const prefilled: string[] = [];
let reading: AppHotkeyReading = {};

function mount(): void {
  act(() =>
    root.render(
      createElement(function Host(): ReactNode {
        usePaletteHotkeys({ onPrefill: (prefix) => prefilled.push(prefix), read: () => reading });
        return null;
      }),
    ),
  );
}

/** 在 window 上派发真实 keydown(监听挂在 window,直调回调挡不住回归) */
function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => window.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  prefilled.length = 0;
  reading = {};
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('应用内快捷键 -> 预填前缀', () => {
  it('默认键:Ctrl+Shift+P 预填 >(命令),Ctrl+P 预填 @(打开笔记),且都抢占默认行为', () => {
    const first = press({ code: 'KeyP', ctrlKey: true, shiftKey: true });
    expect(first.defaultPrevented).toBe(true);
    const second = press({ code: 'KeyP', ctrlKey: true });
    expect(second.defaultPrevented).toBe(true);
    expect(prefilled).toEqual(['>', '@']);
  });

  it('e.repeat 忽略:按住快捷键不会反复预填', () => {
    press({ code: 'KeyP', ctrlKey: true, shiftKey: true, repeat: true });
    expect(prefilled).toEqual([]);
    press({ code: 'KeyP', ctrlKey: true, shiftKey: true });
    expect(prefilled).toEqual(['>']);
  });

  it('存储值非法时回退默认(不静默失效),合法自定义值优先且旧键失效', () => {
    reading = { palette: '不是键名', quickOpen: 'ctrl+alt+k' };
    press({ code: 'KeyP', ctrlKey: true, shiftKey: true }); // palette 非法 -> 默认键仍可用
    press({ code: 'KeyP', ctrlKey: true }); // quickOpen 已改键 -> 旧键不该命中
    press({ code: 'KeyK', ctrlKey: true, altKey: true });
    expect(prefilled).toEqual(['>', '@']);
  });
});

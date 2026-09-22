// 浮层键盘的输入安全边界:输入法组合不抢键(审查 N1)、浮层外的可编辑区域与组合键不双动作(N4)。
// 两条都源于「键盘监听挂在 window,会收到不是给浮层的按键」,所以一律用真实事件派发,
// 直调 handler 挡不住回归。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEditableTarget, isInsidePalette, shouldIgnoreKey } from './palette-target';
import { paletteHarness } from './palette-harness';
import type { PaletteHarness } from './palette-harness';

let ui: PaletteHarness;

beforeEach(() => {
  ui = paletteHarness();
});

afterEach(() => {
  ui.unmount();
});

/** 在指定元素上派发真实 keydown 并返回该事件(判定函数读的是 event.target) */
function fire(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('输入法组合守卫(N1)', () => {
  it('组合中的 Esc 不关浮层、Enter 不接受高亮行', () => {
    ui.open();
    ui.press('Escape', { isComposing: true });
    expect(ui.controller().isOpen).toBe(true);
    ui.press('Enter', { isComposing: true });
    expect(ui.accepted).toEqual([]);
    expect(ui.controller().isOpen).toBe(true);
  });

  it('keyCode 229(只给 keyCode 的 IME 形态)与组合态等价', () => {
    ui.open();
    ui.press('Escape', { keyCode: 229 });
    expect(ui.controller().isOpen).toBe(true);
    ui.press('Enter', { keyCode: 229 });
    expect(ui.accepted).toEqual([]);
    expect(ui.controller().isOpen).toBe(true);
  });
});

describe('浮层外按键不双动作(N4)', () => {
  it('Enter 带 Ctrl/Meta 时浮层不接受(那是其它组件的组合)', () => {
    ui.open();
    ui.press('Enter', { ctrlKey: true });
    ui.press('Enter', { metaKey: true });
    expect(ui.accepted).toEqual([]);
    expect(ui.controller().isOpen).toBe(true);
  });

  it('Composer 持焦时 Enter / Ctrl+Enter 都不触发浮层接受,方向键不被吞,Esc 仍关闭', () => {
    const composer = document.createElement('textarea');
    document.body.appendChild(composer);
    try {
      composer.focus();
      ui.open('');
      composer.focus(); // 命令把焦点交给 Composer(note.new 的实际路径)
      ui.pressFrom(composer, 'Enter', { ctrlKey: true });
      ui.pressFrom(composer, 'Enter');
      expect(ui.accepted).toEqual([]);
      expect(ui.controller().isOpen).toBe(true);
      ui.pressFrom(composer, 'ArrowDown');
      expect(ui.controller().activeIndex).toBe(0);
      ui.pressFrom(composer, 'Escape');
      expect(ui.controller().isOpen).toBe(false);
      expect(document.activeElement).toBe(composer); // 焦点在真实元素上,不抢回
    } finally {
      composer.remove();
    }
  });

  it('浮层外非可编辑目标(如 body)的方向键仍生效(Important 1 不回归)', () => {
    ui.open();
    ui.input().blur();
    ui.pressOnFocus('ArrowDown');
    expect(ui.controller().activeIndex).toBe(1);
  });
});

describe('目标判定函数(palette-target)', () => {
  it('可编辑 = input/textarea/contenteditable(含后代);浮层内 = 命中 data-floating', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const plain = document.createElement('div');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.appendChild(child);
    const locked = document.createElement('span');
    locked.setAttribute('contenteditable', 'false'); // 嵌套关闭可编辑
    editable.appendChild(locked);
    expect([input, area, editable, child, locked, plain].map((el) => isEditableTarget(el))).toEqual([
      true, true, true, true, false, false,
    ]);
    expect(isEditableTarget(null)).toBe(false);
    expect(isInsidePalette(ui.input())).toBe(true);
    expect(isInsidePalette(document.querySelector('[data-floating="palette"]'))).toBe(true);
    expect(isInsidePalette(plain)).toBe(false);
    expect(isInsidePalette(null)).toBe(false);
  });

  it('shouldIgnoreKey:浮层外的可编辑目标除 Esc 外一律忽略,其余目标不忽略', () => {
    const area = document.createElement('textarea');
    const plain = document.createElement('div');
    expect(shouldIgnoreKey(fire(area, 'ArrowDown'))).toBe(true);
    expect(shouldIgnoreKey(fire(area, 'Escape'))).toBe(false);
    expect(shouldIgnoreKey(fire(plain, 'ArrowDown'))).toBe(false);
    expect(shouldIgnoreKey(fire(ui.input(), 'ArrowDown'))).toBe(false);
  });
});

// 焦点归位与应用内快捷键:前者是「关闭浮层不能有副作用」的不变量,后者要求 e.repeat 被忽略、
// 非法存储值回退默认而不是静默失效(T3 审查 Minor 7/8)。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hotkeyHarness, paletteHarness } from './palette-harness';
import type { HotkeyHarness, PaletteHarness } from './palette-harness';

describe('焦点归位(打开前 activeElement -> 关闭后同一元素)', () => {
  let ui: PaletteHarness;
  let other: HTMLButtonElement;

  beforeEach(() => {
    ui = paletteHarness();
    other = document.createElement('button');
    document.body.appendChild(other);
  });

  afterEach(() => {
    ui.unmount();
    other.remove();
  });

  it('Esc 关闭后焦点回到打开前的按钮', () => {
    const trigger = ui.host.querySelector<HTMLButtonElement>('#palette-trigger');
    trigger?.focus();
    ui.open('');
    expect(document.activeElement).toBe(ui.input());
    ui.press('Escape');
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab 关闭并把焦点交回打开前元素(不是浏览器默认的下一个控件)', () => {
    const trigger = ui.host.querySelector<HTMLButtonElement>('#palette-trigger');
    trigger?.focus();
    ui.open('');
    ui.press('Tab');
    expect(document.activeElement).toBe(trigger);
  });

  it('命令自己把焦点移走时不抢回来(如 note.new 聚焦 Composer)', () => {
    ui.unmount(); // 换带副作用的夹具:接受时把焦点移到浮层之外
    ui = paletteHarness({ onAccept: () => other.focus() });
    ui.open('');
    ui.press('Enter');
    expect(document.activeElement).toBe(other);
  });

  it('归位目标已被卸载时不调用 focus(不静默乱移焦点,M3)', () => {
    const trigger = ui.host.querySelector<HTMLButtonElement>('#palette-trigger');
    trigger?.focus();
    ui.open('');
    const spy = vi.spyOn(trigger as HTMLButtonElement, 'focus');
    trigger?.remove();
    ui.input().focus(); // 关闭前焦点仍在浮层输入框(Esc 路径一致)
    ui.press('Escape');
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ui.input());
  });

  it('命令主动把焦点 blur 到 body 时不抢回(M4)', () => {
    ui.unmount();
    ui = paletteHarness({
      onAccept: () => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      },
    });
    const trigger = ui.host.querySelector<HTMLButtonElement>('#palette-trigger');
    trigger?.focus();
    ui.open('');
    const spy = vi.spyOn(trigger as HTMLButtonElement, 'focus');
    ui.press('Enter');
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('应用内快捷键(读取走 effectiveAppHotkey,repeat 忽略)', () => {
  let keys: HotkeyHarness;

  beforeEach(() => {
    keys = hotkeyHarness();
  });

  afterEach(() => {
    keys.unmount();
  });

  it('默认键:Ctrl+Shift+P 开命令面板,Ctrl+P 开笔记,且都抢占默认行为', () => {
    const first = keys.pressWindow({ code: 'KeyP', ctrlKey: true, shiftKey: true });
    expect(first.defaultPrevented).toBe(true);
    keys.pressWindow({ code: 'KeyP', ctrlKey: true });
    expect(keys.triggered).toEqual(['>', '']);
  });

  it('e.repeat 忽略:按住快捷键不会反复打开', () => {
    keys.pressWindow({ code: 'KeyP', ctrlKey: true, shiftKey: true, repeat: true });
    expect(keys.triggered).toEqual([]);
    keys.pressWindow({ code: 'KeyP', ctrlKey: true, shiftKey: true });
    expect(keys.triggered).toEqual(['>']);
  });

  it('存储值非法时回退默认(不静默失效),合法自定义值优先且旧键失效', () => {
    keys.setReading({ palette: '不是键名', quickOpen: 'ctrl+alt+k' });
    keys.pressWindow({ code: 'KeyP', ctrlKey: true, shiftKey: true }); // palette 非法 -> 默认键仍可用
    keys.pressWindow({ code: 'KeyP', ctrlKey: true }); // quickOpen 已改键 -> 旧键不该命中
    keys.pressWindow({ code: 'KeyK', ctrlKey: true, altKey: true });
    expect(keys.triggered).toEqual(['>', '']);
  });
});

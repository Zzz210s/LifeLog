// 浮层外 mousedown 关闭浮层(复审交接清单第 4 条):与 T6「点区块外即保存」共用 data-floating
// 判定 —— 浮层内点击不关、浮层外按下即关。另钉住 window 监听身份稳定(审查 N5):
// 按键不能让监听被反复 remove+add。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paletteHarness } from './palette-harness';
import type { PaletteHarness } from './palette-harness';

let ui: PaletteHarness;

beforeEach(() => {
  ui = paletteHarness();
});

afterEach(() => {
  ui.unmount();
  vi.restoreAllMocks();
});

describe('浮层外点击关闭浮层', () => {
  it('浮层内 mousedown 不关:行上、根节点非行区域都不关', () => {
    ui.open();
    const option = document.querySelector('[role="option"]');
    const root = document.querySelector('[data-floating="palette"]');
    expect(option).not.toBeNull();
    expect(root).not.toBeNull();
    ui.mouseDown(option as Element);
    ui.mouseDown(root as Element);
    expect(ui.controller().isOpen).toBe(true);
  });

  it('浮层外 mousedown 关闭浮层', () => {
    ui.open();
    ui.mouseDown(document.body);
    expect(ui.controller().isOpen).toBe(false);
  });

  it('关闭后浮层外的 mousedown 不再有作用(监听已摘)', () => {
    ui.open();
    ui.mouseDown(document.body);
    expect(ui.controller().isOpen).toBe(false);
    ui.mouseDown(document.body);
    expect(ui.controller().isOpen).toBe(false);
  });

  it('再打开一次仍能关闭(开关不残留状态)', () => {
    ui.open();
    ui.mouseDown(document.body);
    ui.open('>');
    expect(ui.controller().isOpen).toBe(true);
    ui.mouseDown(document.body);
    expect(ui.controller().isOpen).toBe(false);
  });
});

describe('window 监听身份稳定(N5)', () => {
  it('按键 10 次只挂过 1 个 keydown 监听,关闭时摘掉', () => {
    ui.unmount();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    ui = paletteHarness();
    ui.open();
    for (let i = 0; i < 10; i += 1) ui.press('ArrowDown');
    const count = (spy: typeof addSpy): number =>
      spy.mock.calls.filter((call) => call[0] === 'keydown').length;
    expect(count(addSpy)).toBe(1);
    expect(count(removeSpy)).toBe(0);
    ui.press('Escape');
    expect(count(removeSpy)).toBe(1);
  });
});

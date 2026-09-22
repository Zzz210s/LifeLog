// 浮层键盘:真实 React 渲染 + 真实 keydown(经 React 委托监听)—— 只调 handler 是自证式的,
// 监听没接上照样绿。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { paletteHarness } from './palette-harness';
import type { PaletteHarness } from './palette-harness';
import { wrapIndex } from './use-palette';

let ui: PaletteHarness;

beforeEach(() => {
  ui = paletteHarness();
});

afterEach(() => {
  ui.unmount();
});

describe('浮层键盘', () => {
  it('上下方向键移动且边界循环', () => {
    ui.open();
    expect(ui.controller().activeIndex).toBe(0);
    ui.press('ArrowDown');
    expect(ui.controller().activeIndex).toBe(1);
    ui.press('ArrowDown');
    expect(ui.controller().activeIndex).toBe(2);
    ui.press('ArrowDown');
    expect(ui.controller().activeIndex).toBe(0); // 末行再往下回到首行
    ui.press('ArrowUp');
    expect(ui.controller().activeIndex).toBe(2); // 首行再往上回到末行
  });

  it('PageDown/PageUp 跨页并循环(步长 10,取模回绕)', () => {
    ui.open();
    ui.press('PageDown');
    expect(ui.controller().activeIndex).toBe(wrapIndex(0, 10, 3));
    ui.press('PageUp');
    expect(ui.controller().activeIndex).toBe(0);
    ui.press('PageUp');
    expect(ui.controller().activeIndex).toBe(wrapIndex(0, -10, 3));
  });

  it('PageDown/PageUp 真语义:25 项时步长 10,跨过末行后回绕(0->10->20->5->20)', () => {
    ui.unmount();
    const items = Array.from({ length: 25 }, (_, i) => ({ id: `item-${i}`, label: `候选 ${i}` }));
    ui = paletteHarness({ items });
    ui.open();
    expect(ui.controller().rows.length).toBe(25);
    const at = (): number => ui.controller().activeIndex;
    expect(at()).toBe(0);
    ui.press('PageDown');
    expect(at()).toBe(10);
    ui.press('PageDown');
    expect(at()).toBe(20);
    ui.press('PageDown');
    expect(at()).toBe(5); // 30 越过末行 -> 回绕到第 6 行
    ui.press('PageUp');
    expect(at()).toBe(20); // -5 回绕到末页
  });

  it('Home/End 直达首末行,单行结果不越界', () => {
    ui.open();
    ui.press('End');
    expect(ui.controller().activeIndex).toBe(2);
    ui.press('Home');
    expect(ui.controller().activeIndex).toBe(0);
    ui.type('笔记');
    expect(ui.controller().rows.length).toBe(1);
    ui.press('End');
    ui.press('Home');
    expect(ui.controller().activeIndex).toBe(0);
  });

  it('Enter 接受当前行并关闭', () => {
    ui.open();
    ui.press('ArrowDown');
    ui.press('Enter');
    expect(ui.accepted).toEqual([{ id: 'settings.open', keepOpen: false }]);
    expect(ui.controller().isOpen).toBe(false);
  });

  it('Alt+Enter 接受但不关闭,保留查询', () => {
    ui.open();
    ui.type('笔记');
    ui.press('Enter', { altKey: true });
    expect(ui.accepted).toEqual([{ id: 'note.new', keepOpen: true }]);
    expect(ui.controller().isOpen).toBe(true);
    expect(ui.controller().query).toBe('笔记');
  });

  it('Esc 与 Tab 都关闭浮层', () => {
    ui.open();
    ui.press('Escape');
    expect(ui.controller().isOpen).toBe(false);
    ui.open();
    ui.press('Tab');
    expect(ui.controller().isOpen).toBe(false);
  });

  it('e.repeat 的事件一律忽略(按住方向键/回车/快捷键不连发)', () => {
    ui.open();
    ui.press('ArrowDown', { repeat: true });
    expect(ui.controller().activeIndex).toBe(0);
    ui.press('Enter', { repeat: true });
    expect(ui.accepted).toEqual([]);
    ui.press('Escape', { repeat: true });
    expect(ui.controller().isOpen).toBe(true);
  });

  it('空态下 Enter 不可执行,浮层保持打开', () => {
    ui.open();
    ui.type('zzz 无此命令');
    expect(ui.controller().rows.length).toBe(0);
    ui.press('Enter');
    expect(ui.accepted).toEqual([]);
    expect(ui.controller().isOpen).toBe(true);
  });

  it('焦点落到 body(点面板非行区域)后方向键/Esc/Tab/Enter 仍全部生效', () => {
    ui.open();
    ui.input().blur(); // 等价指针点面板内非行区域:焦点离开输入框落到 body
    expect(document.activeElement).toBe(document.body);
    ui.pressOnFocus('ArrowDown');
    expect(ui.controller().activeIndex).toBe(1);
    ui.pressOnFocus('Escape');
    expect(ui.controller().isOpen).toBe(false);

    ui.open();
    ui.input().blur();
    ui.pressOnFocus('Tab');
    expect(ui.controller().isOpen).toBe(false);

    ui.open();
    ui.input().blur();
    ui.pressOnFocus('Enter');
    expect(ui.accepted).toEqual([{ id: 'note.new', keepOpen: false }]);
    expect(ui.controller().isOpen).toBe(false);
  });
});

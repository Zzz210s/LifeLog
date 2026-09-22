/** 浮层按键映射的单测(整体键盘路径另见 palette-keys.dom.test.ts) */
import { describe, expect, it } from 'vitest';
import { PAGE_STEP, resolveKeyAction, wrapIndex } from './palette-keydown';
import type { KeyLike } from './palette-keydown';

const key = (k: string, mod: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mod,
});

describe('palette-keydown:按键 -> 动作', () => {
  it('方向键与翻页走 move,步长含 PAGE_STEP', () => {
    expect(resolveKeyAction(key('ArrowDown'))).toEqual({ type: 'move', delta: 1 });
    expect(resolveKeyAction(key('ArrowUp'))).toEqual({ type: 'move', delta: -1 });
    expect(resolveKeyAction(key('PageDown'))).toEqual({ type: 'move', delta: PAGE_STEP });
    expect(resolveKeyAction(key('PageUp'))).toEqual({ type: 'move', delta: -PAGE_STEP });
  });

  it('Home/End 走 set;Enter 接受(Alt 保持打开),Ctrl/Cmd+Enter 忽略', () => {
    expect(resolveKeyAction(key('Home'))).toEqual({ type: 'set', index: 0 });
    expect(resolveKeyAction(key('End'))).toEqual({ type: 'set', index: -1 });
    expect(resolveKeyAction(key('Enter'))).toEqual({ type: 'accept', keepOpen: false });
    expect(resolveKeyAction(key('Enter', { altKey: true }))).toEqual({ type: 'accept', keepOpen: true });
    expect(resolveKeyAction(key('Enter', { ctrlKey: true }))).toEqual({ type: 'ignore' });
    expect(resolveKeyAction(key('Enter', { metaKey: true }))).toEqual({ type: 'ignore' });
  });

  it('Esc 关闭但不 preventDefault;Tab 关闭且 preventDefault;其它键忽略', () => {
    expect(resolveKeyAction(key('Escape'))).toEqual({ type: 'close', preventDefault: false });
    expect(resolveKeyAction(key('Tab'))).toEqual({ type: 'close', preventDefault: true });
    expect(resolveKeyAction(key('a'))).toEqual({ type: 'ignore' });
    expect(resolveKeyAction(key('F5'))).toEqual({ type: 'ignore' });
  });

  it('wrapIndex 循环取模,空列表恒 0', () => {
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(1, 0, 3)).toBe(1);
    expect(wrapIndex(5, 1, 0)).toBe(0);
  });
});

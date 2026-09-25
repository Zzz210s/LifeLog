/** 边界循环取模的单测(浮层按键映射已随统一输入框删除,整体键盘路径见 unified-keys 的用例) */
import { describe, expect, it } from 'vitest';
import { wrapIndex } from './palette-keydown';

describe('palette-keydown:wrapIndex', () => {
  it('循环取模,空列表恒 0', () => {
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(1, 0, 3)).toBe(1);
    expect(wrapIndex(5, 1, 0)).toBe(0);
  });
});

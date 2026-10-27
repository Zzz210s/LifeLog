/**
 * 合并自同目录下的小用例文件(架构精简 C,2026-10-27):
 *   - palette-keydown.test.ts
 *   - palette-limits.test.ts
 * 每个原文件的顶层 `describe` 原样保留,用例数前后必须逐个相等。
 */
import { describe, expect, it } from 'vitest';
import { MAX_RENDER_ROWS, clampActiveIndex } from './palette-limits';
import { wrapIndex } from './palette-keydown';

describe('palette 合并用例', () => {
  /** 边界循环取模的单测(浮层按键映射已随统一输入框删除,整体键盘路径见 unified-keys 的用例) */

  describe('palette-keydown:wrapIndex', () => {
    it('循环取模,空列表恒 0', () => {
      expect(wrapIndex(0, -1, 3)).toBe(2);
      expect(wrapIndex(2, 1, 3)).toBe(0);
      expect(wrapIndex(1, 0, 3)).toBe(1);
      expect(wrapIndex(5, 1, 0)).toBe(0);
    });
  });

  describe('clampActiveIndex', () => {
    it('夹在候选数与渲染上限的较小者内', () => {
      expect(clampActiveIndex(199, 199)).toBe(MAX_RENDER_ROWS - 1); // 溢出:200 条只画 90 行
      expect(clampActiveIndex(5, 199)).toBe(5);                     // 范围内:不动
      expect(clampActiveIndex(3, 3)).toBe(2);                       // 候选比渲染上限少:夹到末尾
      expect(clampActiveIndex(0, 0)).toBe(0);                       // 空列表:0,不是 -1
      expect(clampActiveIndex(-1, 10)).toBe(0);                     // 负数也夹住
    });
  });

});

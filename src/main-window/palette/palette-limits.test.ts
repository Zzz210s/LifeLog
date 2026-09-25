import { describe, expect, it } from 'vitest';
import { MAX_RENDER_ROWS, clampActiveIndex } from './palette-limits';

describe('clampActiveIndex', () => {
  it('夹在候选数与渲染上限的较小者内', () => {
    expect(clampActiveIndex(199, 199)).toBe(MAX_RENDER_ROWS - 1); // 溢出:200 条只画 90 行
    expect(clampActiveIndex(5, 199)).toBe(5);                     // 范围内:不动
    expect(clampActiveIndex(3, 3)).toBe(2);                       // 候选比渲染上限少:夹到末尾
    expect(clampActiveIndex(0, 0)).toBe(0);                       // 空列表:0,不是 -1
    expect(clampActiveIndex(-1, 10)).toBe(0);                     // 负数也夹住
  });
});

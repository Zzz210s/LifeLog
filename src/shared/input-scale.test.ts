import { describe, expect, it } from 'vitest';
import { nextOpacity, nextScale, resetView, shouldApplyStored, wheelAction } from './input-scale';
import { INPUT_DEFAULTS } from './input-settings';

describe('nextScale', () => {
  it('按步长升降并钳制到 0.5-2.0', () => {
    expect(nextScale(1, 1, 10)).toBeCloseTo(1.1);
    expect(nextScale(1, -1, 10)).toBeCloseTo(0.9);
    expect(nextScale(1.98, 1, 10)).toBe(2);
    expect(nextScale(0.52, -1, 10)).toBe(0.5);
  });
  it('已到边界时不越界(NaN 回退 1.0)', () => {
    expect(nextScale(2, 1, 10)).toBe(2);
    expect(nextScale(0.5, -1, 10)).toBe(0.5);
    expect(nextScale(Number.NaN, 1, 10)).toBe(1.1);
  });
});

describe('nextOpacity', () => {
  it('按步长升降并钳制到 30-100', () => {
    expect(nextOpacity(50, 1, 5)).toBe(55);
    expect(nextOpacity(31, -1, 10)).toBe(30);
    expect(nextOpacity(98, 1, 10)).toBe(100);
  });
  it('结果始终是 30-100 的整数', () => {
    expect(nextOpacity(100, 1, 5)).toBe(100);
    expect(nextOpacity(30, -1, 5)).toBe(30);
    expect(nextOpacity(44.6, 1, 5)).toBe(50);
  });
});

describe('resetView', () => {
  it('缩放回 100%,透明度回默认值', () => {
    const r = resetView({ ...INPUT_DEFAULTS, defaultOpacity: 70 });
    expect(r).toEqual({ scale: 1, opacity: 70 });
  });
});

describe('wheelAction', () => {
  it('Ctrl 时调透明度,否则缩放', () => {
    expect(wheelAction({ ctrlKey: true })).toBe('opacity');
    expect(wheelAction({ ctrlKey: false })).toBe('scale');
  });
});

describe('shouldApplyStored', () => {
  it('未结算的键不采用库里的旧值', () => {
    const pending = new Set(['input_opacity']);
    expect(shouldApplyStored('input_opacity', pending)).toBe(false);
    expect(shouldApplyStored('input_zoom', pending)).toBe(true);
  });

  it('无未结算键时全部采用库值', () => {
    expect(shouldApplyStored('input_opacity', new Set())).toBe(true);
    expect(shouldApplyStored('input_zoom', new Set())).toBe(true);
  });
});

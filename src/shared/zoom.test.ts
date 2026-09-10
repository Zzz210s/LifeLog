import { describe, expect, it } from 'vitest';
import { clampZoom, wheelZoom, ZOOM_MAX, ZOOM_MIN } from './zoom';

describe('clampZoom', () => {
  it('限制在 [0.5, 2.0] 且保留两位小数', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(3)).toBe(ZOOM_MAX);
    expect(clampZoom(1.234)).toBe(1.23);
    expect(clampZoom(1)).toBe(1);
  });
});

describe('wheelZoom', () => {
  it('上滚放大,下滚缩小', () => {
    expect(wheelZoom(1.0, -100)).toBe(1.05);
    expect(wheelZoom(1.0, 100)).toBe(0.95);
  });
  it('到达边界后不再变化', () => {
    expect(wheelZoom(ZOOM_MAX, -100)).toBe(ZOOM_MAX);
    expect(wheelZoom(ZOOM_MIN, 100)).toBe(ZOOM_MIN);
  });
});

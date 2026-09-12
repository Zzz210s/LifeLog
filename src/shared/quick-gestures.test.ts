import { describe, expect, it } from 'vitest';
import { isInDragBand, pressKind } from './quick-gestures';

describe('isInDragBand', () => {
  it('四边 8 像素内为真', () => {
    expect(isInDragBand(0, 100, 400, 300)).toBe(true);
    expect(isInDragBand(396, 100, 400, 300)).toBe(true);
    expect(isInDragBand(200, 0, 400, 300)).toBe(true);
    expect(isInDragBand(200, 296, 400, 300)).toBe(true);
  });
  it('四角为真', () => {
    expect(isInDragBand(2, 2, 400, 300)).toBe(true);
    expect(isInDragBand(399, 299, 400, 300)).toBe(true);
  });
  it('内部为假', () => {
    expect(isInDragBand(200, 150, 400, 300)).toBe(false);
  });
});

describe('pressKind', () => {
  it('第二次按下判为双击', () => {
    expect(pressKind(2)).toBe('double');
  });
  it('第一次按下判为拖动', () => {
    expect(pressKind(1)).toBe('drag');
  });
});

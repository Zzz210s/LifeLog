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
  // 边界语义:左/上带为 [0, band),右/下带为 [w - band, w) 与 [h - band, h),四边各占 band 像素。
  // 400 宽 band=8 时:7 为真(左带最后一列)、8 为假、392 为真(右带第一列)、391 为假。
  it('8 像素语义边界', () => {
    expect(isInDragBand(7, 100, 400, 300)).toBe(true);
    expect(isInDragBand(8, 100, 400, 300)).toBe(false);
    expect(isInDragBand(392, 100, 400, 300)).toBe(true);
    expect(isInDragBand(391, 100, 400, 300)).toBe(false);
  });
  it('自定义 band=12', () => {
    expect(isInDragBand(11, 100, 400, 300, 12)).toBe(true);
    expect(isInDragBand(12, 100, 400, 300, 12)).toBe(false);
    expect(isInDragBand(388, 100, 400, 300, 12)).toBe(true);
    expect(isInDragBand(387, 100, 400, 300, 12)).toBe(false);
    expect(isInDragBand(200, 288, 400, 300, 12)).toBe(true);
    expect(isInDragBand(200, 287, 400, 300, 12)).toBe(false);
  });
});

describe('pressKind', () => {
  it('第二次按下判为双击', () => {
    expect(pressKind(2)).toBe('double');
  });
  it('第一次按下判为拖动', () => {
    expect(pressKind(1)).toBe('drag');
  });
  it('三击的第三次按下仍判为双击', () => {
    expect(pressKind(3)).toBe('double');
    expect(pressKind(4)).toBe('double');
  });
  it('无按下序列计数时判为拖动', () => {
    expect(pressKind(0)).toBe('drag');
  });
});

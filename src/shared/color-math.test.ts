// 颜色数学的取值口径:只认 6 位十六进制,大小写不敏感,先 trim;
// 3 位 / 8 位 / 命名色 / 空串 / null 一律 null(不猜、不补全)。
import { describe, expect, it } from 'vitest';
import { hexToRgb, normalizeHex } from './color-math';

describe('normalizeHex', () => {
  it('大写与不带 # 都归一成六位小写', () => {
    expect(normalizeHex('#1F2328')).toBe('#1f2328');
    expect(normalizeHex('1f2328')).toBe('#1f2328');
    expect(normalizeHex('#AbCdEf')).toBe('#abcdef');
  });

  it('先 trim,两侧空白不算字符', () => {
    expect(normalizeHex('  #1f2328  ')).toBe('#1f2328');
  });

  it('非六位十六进制一律 null', () => {
    expect(normalizeHex(' #fff ')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('#1234567')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('rgb(1,2,3)')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('hexToRgb', () => {
  it('六位十六进制拆成 0-255 三通道', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#1f2328')).toEqual({ r: 31, g: 35, b: 40 });
  });

  it('非法输入 null', () => {
    expect(hexToRgb('#fff')).toBeNull();
    expect(hexToRgb('nope')).toBeNull();
  });
});

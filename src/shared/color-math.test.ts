// 颜色数学的取值口径:只认 6 位十六进制,大小写不敏感,先 trim;
// 3 位 / 8 位 / 命名色 / 空串 / null 一律 null(不猜、不补全)。
import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb, normalizeHex, pickTextInk, relativeLuminance } from './color-math';
import { PALETTE } from './input-appearance-presets';

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

describe('relativeLuminance', () => {
  it('WCAG 相对亮度:黑 0、白 1、中灰走分段线性', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
  });

  it('非法输入回 0', () => {
    expect(relativeLuminance('red')).toBe(0);
    expect(relativeLuminance('#fff')).toBe(0);
  });
});

describe('contrastRatio', () => {
  it('黑白 21:1、同色 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('任一非法输入回 1', () => {
    expect(contrastRatio('red', '#ffffff')).toBe(1);
    expect(contrastRatio('#ffffff', 'blue')).toBe(1);
  });
});

describe('pickTextInk', () => {
  it('黑底给白字、白底给黑字、深灰底给白字', () => {
    expect(pickTextInk('#000000')).toBe('#ffffff');
    expect(pickTextInk('#ffffff')).toBe('#000000');
    expect(pickTextInk('#1f2328')).toBe('#ffffff');
  });

  it('性质:任意底色上选出的墨色对比度都 ≥4.5:1(读数 7 的单元级保障)', () => {
    const samples = [
      ...PALETTE.filter((c) => c !== 'transparent'),
      '#767676',
      '#808080',
      '#8a8a8a',
      '#b0b0b0',
    ];
    for (const bg of samples) {
      expect(contrastRatio(pickTextInk(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

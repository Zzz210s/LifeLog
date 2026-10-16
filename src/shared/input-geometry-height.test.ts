// 输入栏高度侧几何的纯函数测试:底边带判定、最小高度下限区间与钳制、有效高度 = max(自动, 下限)。
// 与 input-geometry.test.ts 拆开的原因同 Rust 侧的 input_width_tests/input_height_tests:
// 单个文件守 200 行上限。
import { describe, expect, it } from 'vitest';
import { GLOW_PAD, MAX_H_LINES, cardEdgeBandCss, clampMinHeightFrom, effectiveHeight, inBottomBand, minHeightHi, minHeightLo, parseMinHeight } from './input-geometry';

describe('inBottomBand(底边带:改高度下限)', () => {
  it('底边带内命中,内部与顶边带都不命中', () => {
    const band = cardEdgeBandCss(1); // 20 CSS px
    expect(inBottomBand(72 - GLOW_PAD, 72, band)).toBe(true); // 可见卡片底边处
    expect(inBottomBand(71.9, 72, band)).toBe(true);
    expect(inBottomBand(52, 72, band)).toBe(true); // 带的上界 = 72 - 20
    expect(inBottomBand(51.9, 72, band)).toBe(false);
    expect(inBottomBand(36, 72, band)).toBe(false);
    expect(inBottomBand(0, 72, band)).toBe(false); // 顶边带:留给移动窗口与双击复位缩放
  });

  it('窗口矮到上下两条带重叠时,下半区归底边、上半区留给顶边带', () => {
    const band = cardEdgeBandCss(0.5); // 20 CSS px;窗口只有 34.5 CSS 高(缩放 0.5 单行)
    expect(inBottomBand(34.5, 34.5, band)).toBe(true);
    expect(inBottomBand(17.25, 34.5, band)).toBe(true);
    expect(inBottomBand(17.2, 34.5, band)).toBe(false);
    expect(inBottomBand(1, 34.5, band)).toBe(false);
  });
});

describe('minHeightLo/Hi(下限区间:基础逻辑像素)', () => {
  // 与 windowHeightFor 同一算式:行高 x 行数 + 固定附加量(内边距 + 边框 + 光晕环 2 x 14)
  const LINE = 22.75;
  const CHROME = 18 + 2 * GLOW_PAD;

  it('下界 = 1 行;上界 = 12 行', () => {
    expect(minHeightLo(LINE, CHROME)).toBe(Math.ceil(LINE + CHROME)); // 69
    expect(minHeightHi(LINE, CHROME, Number.POSITIVE_INFINITY)).toBe(Math.ceil(12 * LINE + CHROME)); // 319
    expect(MAX_H_LINES).toBe(12);
  });

  it('上界再与工作区上限收口,取较小者', () => {
    expect(minHeightHi(LINE, CHROME, 200)).toBe(200);
    expect(minHeightHi(LINE, CHROME, 400)).toBe(Math.ceil(12 * LINE + CHROME)); // 12 行更紧
    expect(minHeightHi(LINE, CHROME, Number.NaN)).toBe(Math.ceil(12 * LINE + CHROME)); // 收口值取不到时不收口
  });
});

describe('clampMinHeightFrom(下限拖动钳制)', () => {
  const lo = 69;
  const hi = 319;

  it('区间内按基线连续走,不跳到边界', () => {
    expect(clampMinHeightFrom(120, 120, lo, hi)).toBe(120);
    expect(clampMinHeightFrom(120, 120.4, lo, hi)).toBe(120);
    expect(clampMinHeightFrom(120, 1000, lo, hi)).toBe(hi);
    expect(clampMinHeightFrom(120, 10, lo, hi)).toBe(lo);
    expect(clampMinHeightFrom(120, Number.NaN, lo, hi)).toBe(120); // 位移取不到方向:停在基线,不跳
  });

  it('基线在区间外(建议列表把窗口顶到 360)时区间向外抬到基线,拖动连续', () => {
    expect(clampMinHeightFrom(360, 360 - 30, lo, hi)).toBe(330);
    expect(clampMinHeightFrom(360, 1000, lo, hi)).toBe(360); // 已经在工作区收口上:往外拖不动
    expect(clampMinHeightFrom(360, 200, lo, hi)).toBe(200); // 朝区间内拖到哪就是哪
  });

  it('基线取不到(非有限)时退回硬区间下界', () => {
    expect(clampMinHeightFrom(Number.NaN, 200, lo, hi)).toBe(200);
    expect(clampMinHeightFrom(Number.POSITIVE_INFINITY, 500, lo, hi)).toBe(hi);
  });
});

describe('effectiveHeight(有效高度 = max(自动, 下限))', () => {
  it('内容比下限高时用自动高度', () => {
    expect(effectiveHeight(160, 69)).toBe(160);
    expect(effectiveHeight(160, 0)).toBe(160);
  });

  it('内容比下限矮时保留下限', () => {
    expect(effectiveHeight(69, 200)).toBe(200);
    expect(effectiveHeight(0, 200)).toBe(200);
  });

  it('非有限/负值不参与', () => {
    expect(effectiveHeight(Number.NaN, 200)).toBe(200);
    expect(effectiveHeight(120, Number.NaN)).toBe(120);
    expect(effectiveHeight(120, -5)).toBe(120);
  });
});

describe('parseMinHeight(读 input_min_h)', () => {
  it('缺失/非数字/非正数一律按 0(纯自动 = 现状)', () => {
    expect(parseMinHeight(null)).toBe(0);
    expect(parseMinHeight('')).toBe(0);
    expect(parseMinHeight('abc')).toBe(0);
    expect(parseMinHeight('0')).toBe(0);
    expect(parseMinHeight('-30')).toBe(0);
    expect(parseMinHeight('NaN')).toBe(0);
  });

  it('正常值取整', () => {
    expect(parseMinHeight('200')).toBe(200);
    expect(parseMinHeight('200.6')).toBe(201);
  });
});

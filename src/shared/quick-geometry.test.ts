import { describe, expect, it } from 'vitest';
import {
  clampLines,
  clampWidth,
  dragBandCss,
  edgeBandCss,
  edgeSide,
  GLOW_PAD,
  heightForLines,
  MAX_WIDTH,
  MIN_WIDTH,
} from './quick-geometry';

describe('clampWidth', () => {
  it('钳制到 240-900', () => {
    expect(clampWidth(100)).toBe(MIN_WIDTH);
    expect(clampWidth(2000)).toBe(MAX_WIDTH);
    expect(clampWidth(500)).toBe(500);
  });

  it('边界值原样保留', () => {
    expect(clampWidth(MIN_WIDTH)).toBe(MIN_WIDTH);
    expect(clampWidth(MAX_WIDTH)).toBe(MAX_WIDTH);
    expect(clampWidth(239.6)).toBe(MIN_WIDTH);
    expect(clampWidth(899.6)).toBe(MAX_WIDTH);
  });

  it('非有限值回退到有方向的一侧', () => {
    expect(clampWidth(Number.NaN)).toBe(MIN_WIDTH);
    expect(clampWidth(Number.POSITIVE_INFINITY)).toBe(MAX_WIDTH);
    expect(clampWidth(Number.NEGATIVE_INFINITY)).toBe(MIN_WIDTH);
  });
});

describe('clampLines', () => {
  it('1 到 5 行', () => {
    expect(clampLines(0)).toBe(1);
    expect(clampLines(3)).toBe(3);
    expect(clampLines(9)).toBe(5);
  });

  it('四舍五入后钳制', () => {
    expect(clampLines(1.4)).toBe(1);
    expect(clampLines(4.6)).toBe(5);
    expect(clampLines(Number.NaN)).toBe(1);
  });
});

describe('heightForLines', () => {
  it('按行高线性增长', () => {
    expect(heightForLines(1, 20)).toBe(20);
    expect(heightForLines(5, 20)).toBe(100);
  });

  it('支持小数行高', () => {
    expect(heightForLines(3, 22.75)).toBeCloseTo(68.25);
  });
});

describe('edgeSide', () => {
  it('左侧 8 像素内为 left', () => {
    expect(edgeSide(3, 400)).toBe('left');
  });
  it('右侧 8 像素内为 right', () => {
    expect(edgeSide(396, 400)).toBe('right');
  });
  it('内部为 null', () => {
    expect(edgeSide(200, 400)).toBeNull();
  });

  it('左带优先于右带判定', () => {
    // 窄窗口时左右带重叠,退回左带,避免同一按下被两套逻辑抢
    expect(edgeSide(3, 12)).toBe('left');
  });

  it('缩放 0.5/1/2 下热区换算为 16/8/4 CSS px', () => {
    expect(edgeBandCss(0.5)).toBe(16);
    expect(edgeBandCss(1)).toBe(8);
    expect(edgeBandCss(2)).toBe(4);
    expect(edgeBandCss(1.3)).toBeCloseTo(6.1538, 3);
  });

  it('非法 ratio 按 1 处理,不会把热区炸成 Infinity', () => {
    expect(edgeBandCss(0)).toBe(8);
    expect(edgeBandCss(-2)).toBe(8);
    expect(edgeBandCss(Number.NaN)).toBe(8);
    expect(edgeBandCss(Number.POSITIVE_INFINITY)).toBe(8);
  });

  it('换算后的带直接用于 edgeSide:0.5 缩放覆盖 16 CSS px,2.0 缩放只剩 4 CSS px', () => {
    expect(edgeSide(15, 400, edgeBandCss(0.5))).toBe('left');
    expect(edgeSide(16, 400, edgeBandCss(0.5))).toBeNull();
    expect(edgeSide(3, 400, edgeBandCss(2))).toBe('left');
    expect(edgeSide(4, 400, edgeBandCss(2))).toBeNull();
  });
});

describe('dragBandCss', () => {
  it('移动窗口的拖动带不小于光晕内边距环(高缩放不把既有环缩窄)', () => {
    expect(dragBandCss(2)).toBe(GLOW_PAD);
    expect(dragBandCss(1.3)).toBe(GLOW_PAD);
    expect(dragBandCss(0.5)).toBe(16); // 8 逻辑像素 > 14 CSS 环:热区随缩放放大
  });
});

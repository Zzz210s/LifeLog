import { describe, expect, it } from 'vitest';
import { clampLines, clampWidth, edgeSide, heightForLines, MAX_WIDTH, MIN_WIDTH } from './quick-geometry';

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

  it('非有限值回退到下限', () => {
    expect(clampWidth(Number.NaN)).toBe(MIN_WIDTH);
    expect(clampWidth(Number.POSITIVE_INFINITY)).toBe(MIN_WIDTH);
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

  it('带边界语义与拖动带一致', () => {
    expect(edgeSide(7, 400)).toBe('left');
    expect(edgeSide(8, 400)).toBeNull();
    expect(edgeSide(392, 400)).toBe('right');
    expect(edgeSide(391, 400)).toBeNull();
    expect(edgeSide(3, 400, 4)).toBe('left');
  });
});

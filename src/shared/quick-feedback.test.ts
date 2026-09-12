import { describe, expect, it } from 'vitest';
import { savedStamp, shouldShowStamp } from './quick-feedback';

describe('savedStamp', () => {
  it('格式为 已保存 HH:MM,分钟补零', () => {
    expect(savedStamp(new Date(2026, 8, 11, 9, 5))).toBe('已保存 09:05');
  });
  it('小时补零', () => {
    expect(savedStamp(new Date(2026, 8, 11, 23, 59))).toBe('已保存 23:59');
  });
});

describe('shouldShowStamp', () => {
  it('1.5 秒内显示', () => {
    expect(shouldShowStamp(1000, 2000)).toBe(true);
  });
  it('超过 1.5 秒不显示', () => {
    expect(shouldShowStamp(1000, 2600)).toBe(false);
  });
  it('未保存过(0)不显示', () => {
    expect(shouldShowStamp(0, 100)).toBe(false);
  });
});

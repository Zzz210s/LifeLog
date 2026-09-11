import { describe, expect, it } from 'vitest';
import { formatStamp, toDateTimeAttr } from './time';

describe('formatStamp', () => {
  it('DB 时间戳截到分钟', () => {
    expect(formatStamp('2026-09-12 08:30:45')).toBe('2026-09-12 08:30');
  });

  it('接受 T 分隔的 ISO 来源', () => {
    expect(formatStamp('2026-09-12T08:30:45')).toBe('2026-09-12 08:30');
  });

  it('日期不足或空串原样返回', () => {
    expect(formatStamp('2026-09-12')).toBe('2026-09-12');
    expect(formatStamp('')).toBe('');
    expect(formatStamp('bad')).toBe('bad');
  });
});

describe('toDateTimeAttr', () => {
  it('空格分隔改为 T', () => {
    expect(toDateTimeAttr('2026-09-12 08:30:45')).toBe('2026-09-12T08:30:45');
  });

  it('已是 ISO 或格式不符时原样返回', () => {
    expect(toDateTimeAttr('2026-09-12T08:30:45')).toBe('2026-09-12T08:30:45');
    expect(toDateTimeAttr('bad')).toBe('bad');
  });
});

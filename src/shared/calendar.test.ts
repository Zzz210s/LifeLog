import { describe, expect, it } from 'vitest';
import { buildMonthCells, daysInMonth, firstWeekdayOffset } from './calendar';

describe('daysInMonth', () => {
  it('闰年二月为 29 天', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('平年二月为 28 天', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('大小月分别为 31 / 30 天', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 9)).toBe(30);
  });
});

describe('firstWeekdayOffset', () => {
  it('2024-01 从周一开始,偏移 0', () => {
    expect(firstWeekdayOffset(2024, 1)).toBe(0);
  });

  it('2023-01 从周日开始,偏移 6', () => {
    expect(firstWeekdayOffset(2023, 1)).toBe(6);
  });
});

describe('buildMonthCells', () => {
  it('长度 = 偏移 + 当月天数', () => {
    // 2026-02 偏移 6 + 28 天 = 34
    expect(buildMonthCells(2026, 2)).toHaveLength(34);
  });

  it('前置 null 数量等于偏移', () => {
    const cells = buildMonthCells(2023, 1);
    expect(firstWeekdayOffset(2023, 1)).toBe(6);
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe(1);
  });

  it('偏移 0 时无前置 null,首格为 1 号', () => {
    const cells = buildMonthCells(2024, 1);
    expect(cells[0]).toBe(1);
    expect(cells).toHaveLength(31);
    expect(cells[30]).toBe(31);
  });
});

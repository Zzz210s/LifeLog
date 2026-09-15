import { describe, expect, it } from 'vitest';
import { isTimeTagPath, normalTags } from './time-tag';

describe('isTimeTagPath', () => {
  it('时间根与时间子树命中', () => {
    expect(isTimeTagPath('时间排序')).toBe(true);
    expect(isTimeTagPath('时间排序/2026/09/15')).toBe(true);
    expect(isTimeTagPath('时间排序/2026')).toBe(true);
  });

  it('前缀相近的普通标签不命中', () => {
    expect(isTimeTagPath('时间排序表')).toBe(false);
    expect(isTimeTagPath('工作/时间排序')).toBe(false);
    expect(isTimeTagPath('todo')).toBe(false);
    expect(isTimeTagPath('')).toBe(false);
  });
});

describe('normalTags', () => {
  it('只留普通标签,顺序不变', () => {
    expect(normalTags(['todo', '时间排序/2026/09/15', '工作/A'])).toEqual(['todo', '工作/A']);
  });

  it('全为时间标签时为空', () => {
    expect(normalTags(['时间排序/2026/09/15'])).toEqual([]);
  });
});

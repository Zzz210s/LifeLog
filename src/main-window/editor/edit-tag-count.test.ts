import { describe, expect, it } from 'vitest';
import { TAG_COUNT_HINT_MAX, tagCountHint, tagCountLabel } from './edit-tag-count';

describe('tagCountLabel', () => {
  it('中文文案「标签 N 个」', () => {
    expect(tagCountLabel(0)).toBe('标签 0 个');
    expect(tagCountLabel(3)).toBe('标签 3 个');
  });
});

describe('tagCountHint', () => {
  it('阈值为 5:5 个及以下不提示', () => {
    expect(TAG_COUNT_HINT_MAX).toBe(5);
    expect(tagCountHint(0)).toBeNull();
    expect(tagCountHint(5)).toBeNull();
  });
  it('超过 5 个提示「建议 3-5 个」', () => {
    expect(tagCountHint(6)).toBe('建议 3-5 个');
    expect(tagCountHint(11)).toBe('建议 3-5 个');
  });
});

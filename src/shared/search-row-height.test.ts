/**
 * 「快捷搜索栏行高」的纯函数(2026-10-17):默认值、钳制与字号档。
 * 真实渲染在 `unified/UnifiedTextarea`(行高) 与设置页「外观」(滑块)。
 */
import { describe, expect, it } from 'vitest';
import {
  SEARCH_ROW_HEIGHT_DEFAULT,
  SEARCH_ROW_HEIGHT_MAX,
  SEARCH_ROW_HEIGHT_MIN,
  normalizeSearchRowHeight,
  searchFontClass,
  searchLineHeight,
} from './search-row-height';

describe('快捷搜索栏行高', () => {
  it('默认 36:与 Edge 地址栏(32px 控件 + 上下各 2px)同一口径', () => {
    expect(SEARCH_ROW_HEIGHT_DEFAULT).toBe(36);
    expect(normalizeSearchRowHeight(undefined)).toBe(36);
    expect(normalizeSearchRowHeight(null)).toBe(36);
    expect(normalizeSearchRowHeight('abc')).toBe(36);
  });

  // 变异自证:把默认值改回旧的 32 → 上面那条立刻红
  it('越界与非法值一律钳到区间,并按步长 2 对齐', () => {
    expect(normalizeSearchRowHeight(0)).toBe(SEARCH_ROW_HEIGHT_MIN);
    expect(normalizeSearchRowHeight(-8)).toBe(SEARCH_ROW_HEIGHT_MIN);
    expect(normalizeSearchRowHeight(999)).toBe(SEARCH_ROW_HEIGHT_MAX);
    expect(normalizeSearchRowHeight(37)).toBe(38);
    expect(normalizeSearchRowHeight('44')).toBe(44);
  });

  it('行高 = 设置值 − 上下内边距(12):空输入恰好撑满设置的高度', () => {
    expect(searchLineHeight(36)).toBe(24);
    expect(searchLineHeight(44)).toBe(32);
  });

  it('字号随行高升档(四档),小行高不放大字', () => {
    expect(searchFontClass(28)).toBe('text-ui');
    expect(searchFontClass(36)).toBe('text-sm');
    expect(searchFontClass(44)).toBe('text-base');
    expect(searchFontClass(56)).toBe('text-lg');
  });
});

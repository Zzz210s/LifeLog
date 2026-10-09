import { describe, expect, it } from 'vitest';
import { isNarrowNav, NARROW_NAV_PX, normalizeSection, SETTINGS_SECTIONS } from './settings-sections';

describe('分区注册表', () => {
  it('顺序与命名固定(设计 D9)', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      'appearance',
      'inputAppearance',
      'inputBehavior',
      'notes',
      'relations',
      'hotkey',
      'startup',
      'general',
      'about',
    ]);
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      '外观',
      '输入栏外观',
      '输入栏行为',
      '条目',
      '实体关系',
      '快捷键',
      '启动',
      '通用',
      '关于',
    ]);
  });

  it('说明句只给需要的分区', () => {
    expect(SETTINGS_SECTIONS.filter((s) => s.note).map((s) => s.id)).toEqual([
      'appearance',
      'inputBehavior',
      'about',
    ]);
  });
});

describe('isNarrowNav(窄窗口判定)', () => {
  it('小于 900 视为窄', () => {
    expect(isNarrowNav(NARROW_NAV_PX - 1)).toBe(true);
    expect(isNarrowNav(NARROW_NAV_PX)).toBe(false);
  });
  it('拿不到宽度(NaN)不算窄,避免误切成 tab 条', () => {
    expect(isNarrowNav(Number.NaN)).toBe(false);
  });
});

describe('normalizeSection(非法 id 兜底)', () => {
  it('未知 id 退回第一个分区', () => {
    expect(normalizeSection('nope')).toBe('appearance');
    expect(normalizeSection(null)).toBe('appearance');
    expect(normalizeSection(undefined)).toBe('appearance');
  });
  it('合法 id 原样返回', () => {
    expect(normalizeSection('inputBehavior')).toBe('inputBehavior');
  });
});

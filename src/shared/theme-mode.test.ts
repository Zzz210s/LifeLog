import { describe, expect, it } from 'vitest';
import {
  parseThemeMode,
  parseThemePayload,
  resolveDark,
  THEME_DEFAULT,
  THEME_KEY,
  THEME_MODES,
} from './theme-mode';

describe('parseThemeMode', () => {
  it('合法三态原样返回', () => {
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('system')).toBe('system');
  });

  it('缺失与空串回退 system', () => {
    expect(parseThemeMode(null)).toBe(THEME_DEFAULT);
    expect(parseThemeMode(undefined)).toBe(THEME_DEFAULT);
    expect(parseThemeMode('')).toBe(THEME_DEFAULT);
  });

  it('非法值回退 system(含大小写与前后空白)', () => {
    expect(parseThemeMode('Dark')).toBe('system');
    expect(parseThemeMode(' dark')).toBe('system');
    expect(parseThemeMode('auto')).toBe('system');
    expect(parseThemeMode('true')).toBe('system');
  });
});

describe('resolveDark', () => {
  it('显式两态不受系统影响', () => {
    expect(resolveDark('dark', false)).toBe(true);
    expect(resolveDark('light', true)).toBe(false);
  });

  it('system 完全跟随系统偏好', () => {
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
  });
});

describe('parseThemePayload', () => {
  it('字符串载荷按三态解析', () => {
    expect(parseThemePayload('dark')).toBe('dark');
    expect(parseThemePayload('bogus')).toBe('system');
  });

  it('非字符串载荷返回 null(调用方忽略该事件)', () => {
    expect(parseThemePayload(undefined)).toBeNull();
    expect(parseThemePayload(null)).toBeNull();
    expect(parseThemePayload({ mode: 'dark' })).toBeNull();
    expect(parseThemePayload(1)).toBeNull();
  });
});

describe('常量', () => {
  it('设置键与默认值锁定', () => {
    expect(THEME_KEY).toBe('theme');
    expect(THEME_DEFAULT).toBe('system');
  });

  it('外观分区三态顺序:跟随系统、亮色、暗色', () => {
    expect(THEME_MODES.map((m) => m.value)).toEqual(['system', 'light', 'dark']);
    expect(THEME_MODES.map((m) => m.label)).toEqual(['跟随系统', '亮色', '暗色']);
  });
});

// 外观设置键的解析 / 序列化 / IO 口径。
// 关键钉:APPEARANCE_KEYS.opacity 必须是 'input_bg_opacity'(与整窗不透明度 input_opacity 不撞名)。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  clampBgOpacity,
  clampRadius,
  loadAppearance,
  parseAppearance,
  parseBorderColor,
  parsePreset,
  parseShadow,
  parseSurfaceColor,
  saveAppearance,
  serializeAppearance,
} from './input-appearance';

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_k: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_k: string, _v: string): Promise<void> => undefined),
}));
vi.mock('./api', () => ({ api: { getSetting, setSetting } }));

beforeEach(() => {
  getSetting.mockReset();
  getSetting.mockResolvedValue(null);
  setSetting.mockReset();
  setSetting.mockResolvedValue(undefined);
});

describe('APPEARANCE_KEYS', () => {
  it('透明度的键是 input_bg_opacity,不是被整窗占用的 input_opacity', () => {
    expect(APPEARANCE_KEYS.opacity).toBe('input_bg_opacity');
    expect(APPEARANCE_KEYS.opacity).not.toBe('input_opacity');
    expect(APPEARANCE_KEYS).toEqual({
      bg: 'input_bg',
      bgDark: 'input_bg_dark',
      border: 'input_border',
      borderDark: 'input_border_dark',
      radius: 'input_radius',
      shadow: 'input_shadow',
      opacity: 'input_bg_opacity',
      preset: 'input_preset',
    });
  });
});

describe('clamp / parse', () => {
  it('圆角四舍五入后夹 0-16,非有限回 0', () => {
    expect(clampRadius(6.4)).toBe(6);
    expect(clampRadius(99)).toBe(16);
    expect(clampRadius(-3)).toBe(0);
    expect(clampRadius(Number.NaN)).toBe(0);
  });

  it('背景透明度夹 0-100,非有限回 100', () => {
    expect(clampBgOpacity(40.6)).toBe(41);
    expect(clampBgOpacity(120)).toBe(100);
    expect(clampBgOpacity(-5)).toBe(0);
    expect(clampBgOpacity(Number.NaN)).toBe(100);
  });

  it('底色值域 theme | transparent | #rrggbb', () => {
    expect(parseSurfaceColor('transparent')).toBe('transparent');
    expect(parseSurfaceColor(' theme ')).toBe('theme');
    expect(parseSurfaceColor('#1F2328')).toBe('#1f2328');
    expect(parseSurfaceColor('red')).toBe('theme');
    expect(parseSurfaceColor(null)).toBe('theme');
  });

  it('边框值域多一项 surface,并接受 transparent', () => {
    expect(parseBorderColor('surface')).toBe('surface');
    expect(parseBorderColor('transparent')).toBe('transparent');
    expect(parseBorderColor('theme')).toBe('theme');
    expect(parseBorderColor('#0ea5e9')).toBe('#0ea5e9');
    expect(parseBorderColor('nonsense')).toBe('theme');
    expect(parseBorderColor(null)).toBe('theme');
  });

  it('阴影只认 0-3,非法与超界就近夹取', () => {
    expect(parseShadow('0')).toBe(0);
    expect(parseShadow('3')).toBe(3);
    expect(parseShadow('9')).toBe(3);
    expect(parseShadow('-2')).toBe(0);
    expect(parseShadow('abc')).toBe(1);
    expect(parseShadow(null)).toBe(1);
  });

  it('预设只认五个 id,非法回 custom,缺键回默认 sticker', () => {
    expect(parsePreset('glass')).toBe('glass');
    expect(parsePreset('custom')).toBe('custom');
    expect(parsePreset('nonsense')).toBe('custom');
    expect(parsePreset(null)).toBe('sticker');
  });
});

describe('parseAppearance', () => {
  it('空对象回默认', () => {
    expect(parseAppearance({})).toEqual(APPEARANCE_DEFAULTS);
  });

  it('缺键与非法值都回落到默认', () => {
    const raw = {
      input_bg: 'red',
      input_radius: 'abc',
      input_shadow: 'abc',
      input_bg_opacity: 'abc',
      input_border: 'nonsense',
    };
    expect(parseAppearance(raw)).toEqual(APPEARANCE_DEFAULTS);
  });

  it('透明度边界 0 与 100 原样保留', () => {
    expect(parseAppearance({ input_bg_opacity: '0' }).opacity).toBe(0);
    expect(parseAppearance({ input_bg_opacity: '100' }).opacity).toBe(100);
  });

  it('合法值逐项读出', () => {
    const raw = {
      input_bg: '#1F2328',
      input_bg_dark: 'transparent',
      input_border: 'surface',
      input_border_dark: '#ef4444',
      input_radius: '12',
      input_shadow: '2',
      input_bg_opacity: '65',
      input_preset: 'glass',
    };
    expect(parseAppearance(raw)).toEqual({
      bg: '#1f2328',
      bgDark: 'transparent',
      border: 'surface',
      borderDark: '#ef4444',
      radius: 12,
      shadow: 2,
      opacity: 65,
      preset: 'glass',
    });
  });
});

describe('serializeAppearance', () => {
  it('数值取整成十进制字符串,颜色原样', () => {
    expect(serializeAppearance('radius', 6.4)).toBe('6');
    expect(serializeAppearance('opacity', 40.5)).toBe('41');
    expect(serializeAppearance('bg', '#abcdef')).toBe('#abcdef');
    expect(serializeAppearance('preset', 'custom')).toBe('custom');
  });
});

describe('loadAppearance / saveAppearance', () => {
  it('缺键 + 非法值 -> 全默认', async () => {
    getSetting.mockImplementation(async (key: string) => {
      if (key === 'input_radius') return 'abc';
      if (key === 'input_bg') return 'red';
      return null;
    });
    await expect(loadAppearance()).resolves.toEqual(APPEARANCE_DEFAULTS);
    expect(getSetting).toHaveBeenCalledTimes(8);
  });

  it('按库值读出,写库走 APPEARANCE_KEYS', async () => {
    getSetting.mockImplementation(async (key: string) =>
      key === 'input_radius' ? '12' : key === 'input_bg' ? '#1f2328' : null,
    );
    const got = await loadAppearance();
    expect(got.radius).toBe(12);
    expect(got.bg).toBe('#1f2328');
    await saveAppearance('radius', 8);
    expect(setSetting).toHaveBeenCalledWith('input_radius', '8');
  });
});
// 四套预设与色盘的定值:预设只写「一组值」,套用后仍可逐项微调(改任意项 -> preset=custom)。
import { describe, expect, it } from 'vitest';
import { normalizeHex } from './color-math';
import { APPEARANCE_DEFAULTS, type InputAppearance } from './input-appearance';
import {
  PALETTE,
  PRESETS,
  PRESET_ORDER,
  SHADOW_LABELS,
  applyPreset,
  presetLabel,
  withAppearanceChange,
} from './input-appearance-presets';

const base: InputAppearance = {
  ...APPEARANCE_DEFAULTS,
  bg: '#111111',
  bgDark: '#222222',
  border: '#333333',
  borderDark: '#444444',
  radius: 7,
  shadow: 3,
  opacity: 40,
  preset: 'custom',
};

describe('PRESET_ORDER / SHADOW_LABELS', () => {
  it('预设顺序与阴影档位文案', () => {
    expect(PRESET_ORDER).toEqual(['sticker', 'minimal', 'glass', 'solid']);
    expect(SHADOW_LABELS).toEqual(['无', '轻', '中', '强']);
    expect(SHADOW_LABELS).toHaveLength(4);
  });
});

describe('PRESETS', () => {
  it('五列逐值(贴纸圆角 0 = 今天的现状)', () => {
    expect(PRESETS.sticker).toEqual({ label: '贴纸', bg: 'theme', border: 'theme', radius: 0, shadow: 1, opacity: 100 });
    expect(PRESETS.minimal).toEqual({ label: '极简', bg: 'theme', border: 'transparent', radius: 0, shadow: 0, opacity: 100 });
    expect(PRESETS.glass).toEqual({ label: '玻璃', bg: 'theme', border: 'theme', radius: 12, shadow: 2, opacity: 65 });
    expect(PRESETS.solid).toEqual({ label: '纯色', bg: 'theme', border: 'surface', radius: 6, shadow: 1, opacity: 100 });
  });
});

describe('PALETTE', () => {
  it('12 色 + 末尾透明格,共 13', () => {
    expect(PALETTE).toHaveLength(13);
    expect(PALETTE[PALETTE.length - 1]).toBe('transparent');
  });

  it('除透明格外都是合法六位十六进制', () => {
    for (const cell of PALETTE) {
      if (cell === 'transparent') continue;
      expect(normalizeHex(cell)).toBe(cell);
    }
  });
});

describe('applyPreset', () => {
  it('写满 7 个字段,bg/border 亮暗同色,形状值按预设', () => {
    expect(applyPreset(base, 'glass')).toEqual({
      bg: 'theme',
      bgDark: 'theme',
      border: 'theme',
      borderDark: 'theme',
      radius: 12,
      shadow: 2,
      opacity: 65,
      preset: 'glass',
    });
  });

  it('纯色预设的边框跟随底色(surface)', () => {
    expect(applyPreset(base, 'solid').border).toBe('surface');
  });
});

describe('withAppearanceChange', () => {
  it('改非 preset 项后标为 custom', () => {
    expect(withAppearanceChange(base, 'radius', 8).preset).toBe('custom');
    expect(withAppearanceChange(base, 'radius', 8).radius).toBe(8);
    expect(withAppearanceChange(base, 'bg', '#abcdef').bg).toBe('#abcdef');
  });

  it('key=preset 时等价于 applyPreset', () => {
    expect(withAppearanceChange(base, 'preset', 'solid')).toEqual(applyPreset(base, 'solid'));
  });

  it("显式传 preset='custom' 只标 custom,不动其它字段", () => {
    expect(withAppearanceChange(base, 'preset', 'custom')).toEqual({ ...base, preset: 'custom' });
  });
});

describe('presetLabel', () => {
  it('custom 显示「自定义」,内置项用各自 label', () => {
    expect(presetLabel('custom')).toBe('自定义');
    expect(presetLabel('sticker')).toBe('贴纸');
    expect(presetLabel('glass')).toBe('玻璃');
  });
});

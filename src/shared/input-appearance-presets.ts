// 四套预设、色盘与阴影档位文案的定值。
// 预设只是「一组值」:套用后写进各个 KV 键,之后照常逐项微调(改任意项 -> preset=custom)。
import type { BorderColor, InputAppearance, PresetId, ShadowLevel, SurfaceColor } from './input-appearance';
import type { Hex } from './color-math';

export type BuiltinPreset = Exclude<PresetId, 'custom'>;

export interface PresetSpec {
  label: string;
  bg: SurfaceColor;
  border: BorderColor;
  radius: number;
  shadow: ShadowLevel;
  opacity: number;
}

export const PRESET_ORDER: readonly BuiltinPreset[] = ['sticker', 'minimal', 'glass', 'solid'];

export const PRESETS: Record<BuiltinPreset, PresetSpec> = {
  // 贴纸 = 现状:圆角 0(现状从无 border-radius,见计划 §0-3)
  sticker: { label: '贴纸', bg: 'theme', border: 'theme', radius: 0, shadow: 1, opacity: 100 },
  minimal: { label: '极简', bg: 'theme', border: 'transparent', radius: 0, shadow: 0, opacity: 100 },
  glass: { label: '玻璃', bg: 'theme', border: 'theme', radius: 12, shadow: 2, opacity: 65 },
  // 纯色:边框跟随底色(surface),看不见边;圆角 6 让四套预设彼此可辨
  solid: { label: '纯色', bg: 'theme', border: 'surface', radius: 6, shadow: 1, opacity: 100 },
};

/** 12 色 + 末尾透明格;透明格只给底色(边框不提供透明格) */
export const PALETTE: readonly (Hex | 'transparent')[] = [
  '#000000',
  '#1f2328',
  '#5e666f',
  '#9aa1a9',
  '#e3e5e8',
  '#ffffff',
  '#2563eb',
  '#0ea5e9',
  '#10b981',
  '#eab308',
  '#f97316',
  '#ef4444',
  'transparent',
];

export const SHADOW_LABELS = ['无', '轻', '中', '强'] as const;

/** 写满 7 个字段:bg/bgDark 同色、border/borderDark 同边框,形状值亮暗共用 */
export function applyPreset(a: InputAppearance, id: BuiltinPreset): InputAppearance {
  const spec = PRESETS[id];
  return {
    ...a,
    bg: spec.bg,
    bgDark: spec.bg,
    border: spec.border,
    borderDark: spec.border,
    radius: spec.radius,
    shadow: spec.shadow,
    opacity: spec.opacity,
    preset: id,
  };
}

/** 手动改任意一项即离开预设;key=preset 时走 applyPreset('custom' 只标状态,不动其它字段) */
export function withAppearanceChange<K extends keyof InputAppearance>(
  a: InputAppearance,
  key: K,
  value: InputAppearance[K],
): InputAppearance {
  if (key === 'preset') {
    if (value === 'custom') return { ...a, preset: 'custom' };
    return applyPreset(a, value as BuiltinPreset);
  }
  return { ...a, [key]: value, preset: 'custom' };
}

export function presetLabel(id: PresetId): string {
  return id === 'custom' ? '自定义' : PRESETS[id].label;
}

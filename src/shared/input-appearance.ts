// 输入栏外观设置键:值域、解析、序列化与 IO(与 shared/input-settings.ts 同形)。
// 亮暗各存一份颜色(bg/bgDark、border/borderDark);圆角/阴影/透明度亮暗共用(形状不随主题变)。
// 读失败向上抛,由调用方兜底(输入栏静默保持默认 = 回退主题令牌,见 use-sticker-appearance)。
import { api } from './api';
import { normalizeHex, type Hex } from './color-math';

export type SurfaceColor = 'theme' | 'transparent' | Hex;
export type BorderColor = 'theme' | 'surface' | 'transparent' | Hex;
export type ShadowLevel = 0 | 1 | 2 | 3;
export type PresetId = 'sticker' | 'minimal' | 'glass' | 'solid' | 'custom';

export interface InputAppearance {
  bg: SurfaceColor;
  bgDark: SurfaceColor;
  border: BorderColor;
  borderDark: BorderColor;
  radius: number;
  shadow: ShadowLevel;
  opacity: number;
  preset: PresetId;
}

/** opacity -> input_bg_opacity:input_opacity 是整窗不透明度(见 input-bar/use-input-view-store.ts) */
export const APPEARANCE_KEYS: Record<keyof InputAppearance, string> = {
  bg: 'input_bg',
  bgDark: 'input_bg_dark',
  border: 'input_border',
  borderDark: 'input_border_dark',
  radius: 'input_radius',
  shadow: 'input_shadow',
  opacity: 'input_bg_opacity',
  preset: 'input_preset',
};

export const APPEARANCE_DEFAULTS: InputAppearance = {
  bg: 'theme',
  bgDark: 'theme',
  border: 'theme',
  borderDark: 'theme',
  radius: 0,
  shadow: 1,
  opacity: 100,
  preset: 'sticker',
};

export const RADIUS_MIN = 0;
export const RADIUS_MAX = 16;
export const BG_OPACITY_MIN = 0;
export const BG_OPACITY_MAX = 100;

/** 数值只接受十进制(空串、abc、0x10、1e3 一律 null,由调用方回退) */
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function clampInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampRadius(value: number): number {
  return clampInt(value, APPEARANCE_DEFAULTS.radius, RADIUS_MIN, RADIUS_MAX);
}

export function clampBgOpacity(value: number): number {
  return clampInt(value, APPEARANCE_DEFAULTS.opacity, BG_OPACITY_MIN, BG_OPACITY_MAX);
}

function parseNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  return NUMBER_RE.test(text) ? Number(text) : null;
}

/** 底色:theme | transparent | #rrggbb;其余(含缺失)回 theme */
export function parseSurfaceColor(raw: string | null): SurfaceColor {
  if (raw === null) return 'theme';
  const text = raw.trim();
  if (text === 'theme' || text === 'transparent') return text;
  return normalizeHex(text) ?? 'theme';
}

/** 边框:比底色多一项 surface(= 同底色,看不见边) */
export function parseBorderColor(raw: string | null): BorderColor {
  if (raw === null) return 'theme';
  const text = raw.trim();
  if (text === 'theme' || text === 'surface' || text === 'transparent') return text;
  return normalizeHex(text) ?? 'theme';
}

export function parseShadow(raw: string | null): ShadowLevel {
  const value = parseNumber(raw);
  const level = value === null ? APPEARANCE_DEFAULTS.shadow : Math.round(value);
  if (level <= 0) return 0;
  if (level >= 3) return 3;
  return level as ShadowLevel;
}

/** 缺失(未设过)回默认 sticker;写了但不认识回 custom(外观已偏离预设) */
export function parsePreset(raw: string | null): PresetId {
  if (raw === null) return APPEARANCE_DEFAULTS.preset;
  if (raw === 'sticker' || raw === 'minimal' || raw === 'glass' || raw === 'solid' || raw === 'custom') {
    return raw;
  }
  return 'custom';
}

export function parseAppearance(raw: Record<string, string | null>): InputAppearance {
  const get = (key: keyof InputAppearance): string | null => raw[APPEARANCE_KEYS[key]] ?? null;
  const radius = parseNumber(get('radius'));
  const opacity = parseNumber(get('opacity'));
  return {
    bg: parseSurfaceColor(get('bg')),
    bgDark: parseSurfaceColor(get('bgDark')),
    border: parseBorderColor(get('border')),
    borderDark: parseBorderColor(get('borderDark')),
    radius: radius === null ? APPEARANCE_DEFAULTS.radius : clampRadius(radius),
    shadow: parseShadow(get('shadow')),
    opacity: opacity === null ? APPEARANCE_DEFAULTS.opacity : clampBgOpacity(opacity),
    preset: parsePreset(get('preset')),
  };
}

export function serializeAppearance<K extends keyof InputAppearance>(
  // 参数只为类型收窄(运行期不读 _key) —— 下划线前缀避免未用告警
  _key: K,
  value: InputAppearance[K],
): string {
  return typeof value === 'number' ? String(Math.round(value)) : String(value);
}

export async function loadAppearance(): Promise<InputAppearance> {
  const fields = Object.keys(APPEARANCE_KEYS) as (keyof InputAppearance)[];
  const values = await Promise.all(fields.map((field) => api.getSetting(APPEARANCE_KEYS[field])));
  const raw: Record<string, string | null> = {};
  fields.forEach((field, i) => {
    raw[APPEARANCE_KEYS[field]] = values[i];
  });
  return parseAppearance(raw);
}

export async function saveAppearance<K extends keyof InputAppearance>(
  key: K,
  value: InputAppearance[K],
): Promise<void> {
  await api.setSetting(APPEARANCE_KEYS[key], serializeAppearance(key, value));
}

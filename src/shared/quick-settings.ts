// 快捷窗的 9 个设置键:解析、序列化与 IO。
// 读取入口 loadQuickSettings() 可重复调用(窗口每次显示都重载,见 Task 5);
// 读失败向上抛,由调用方提示,不静默给默认值。
import { api } from './api';
import { clampOpacity, clampStep } from './quick-scale';

export interface QuickSettings {
  alwaysOnTop: boolean;
  hideOnBlur: boolean;
  zoomStep: number;
  defaultOpacity: number;
  opacityStep: number;
  lockMove: boolean;
  lockClose: boolean;
  lockContent: boolean;
  doubleClickAction: 'hide' | 'none';
}

export const QUICK_KEYS: Record<keyof QuickSettings, string> = {
  alwaysOnTop: 'quick_always_on_top',
  hideOnBlur: 'quick_hide_on_blur',
  zoomStep: 'quick_zoom_step',
  defaultOpacity: 'quick_default_opacity',
  opacityStep: 'quick_opacity_step',
  lockMove: 'quick_lock_move',
  lockClose: 'quick_lock_close',
  lockContent: 'quick_lock_content',
  doubleClickAction: 'quick_double_click_action',
};

export const QUICK_DEFAULTS: QuickSettings = {
  alwaysOnTop: true,
  hideOnBlur: false,
  zoomStep: 10,
  defaultOpacity: 100,
  opacityStep: 5,
  lockMove: false,
  lockClose: false,
  lockContent: false,
  doubleClickAction: 'hide',
};

/** 数值只接受十进制(空串、abc、0x10、1e3 一律回退默认值) */
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const BOOL_FIELDS = ['alwaysOnTop', 'hideOnBlur', 'lockMove', 'lockClose', 'lockContent'] as const;
const NUM_FIELDS = ['zoomStep', 'defaultOpacity', 'opacityStep'] as const;

type BoolField = (typeof BOOL_FIELDS)[number];
type NumField = (typeof NUM_FIELDS)[number];

function pick(raw: Record<string, string | null>, field: keyof QuickSettings): string | null {
  return raw[QUICK_KEYS[field]] ?? null;
}

/** 键存在且值为 'true' 才是真;缺失与空串回退默认值 */
function parseBool(raw: Record<string, string | null>, field: BoolField): boolean {
  const value = pick(raw, field);
  if (value === null || value === '') return QUICK_DEFAULTS[field];
  return value === 'true';
}

function parseNum(
  raw: Record<string, string | null>,
  field: NumField,
  clamp: (n: number) => number,
): number {
  const value = pick(raw, field);
  if (value === null) return QUICK_DEFAULTS[field];
  const text = value.trim();
  if (!NUMBER_RE.test(text)) return QUICK_DEFAULTS[field];
  return clamp(Number(text));
}

export function parseQuickSettings(raw: Record<string, string | null>): QuickSettings {
  return {
    alwaysOnTop: parseBool(raw, 'alwaysOnTop'),
    hideOnBlur: parseBool(raw, 'hideOnBlur'),
    zoomStep: parseNum(raw, 'zoomStep', clampStep),
    defaultOpacity: parseNum(raw, 'defaultOpacity', clampOpacity),
    opacityStep: parseNum(raw, 'opacityStep', clampStep),
    lockMove: parseBool(raw, 'lockMove'),
    lockClose: parseBool(raw, 'lockClose'),
    lockContent: parseBool(raw, 'lockContent'),
    doubleClickAction: pick(raw, 'doubleClickAction') === 'none' ? 'none' : 'hide',
  };
}

export function serializeQuickSetting<K extends keyof QuickSettings>(
  key: K,
  value: QuickSettings[K],
): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(Math.round(value));
  return String(value);
}

export async function loadQuickSettings(): Promise<QuickSettings> {
  const fields = Object.keys(QUICK_KEYS) as (keyof QuickSettings)[];
  const values = await Promise.all(fields.map((f) => api.getSetting(QUICK_KEYS[f])));
  const raw: Record<string, string | null> = {};
  fields.forEach((f, i) => {
    raw[QUICK_KEYS[f]] = values[i];
  });
  return parseQuickSettings(raw);
}

export async function saveQuickSetting<K extends keyof QuickSettings>(
  key: K,
  value: QuickSettings[K],
): Promise<void> {
  await api.setSetting(QUICK_KEYS[key], serializeQuickSetting(key, value));
}

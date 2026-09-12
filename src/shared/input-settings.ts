// 输入栏的 9 个设置键:解析、序列化与 IO。
// 读取入口 loadInputSettings() 可重复调用(窗口每次显示都重载,见 Task 5);
// 读失败向上抛,由调用方提示,不静默给默认值。
import { api } from './api';
import { clampOpacity, clampStep } from './input-scale';

export interface InputSettings {
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

export const INPUT_KEYS: Record<keyof InputSettings, string> = {
  alwaysOnTop: 'input_always_on_top',
  hideOnBlur: 'input_hide_on_blur',
  zoomStep: 'input_zoom_step',
  defaultOpacity: 'input_default_opacity',
  opacityStep: 'input_opacity_step',
  lockMove: 'input_lock_move',
  lockClose: 'input_lock_close',
  lockContent: 'input_lock_content',
  doubleClickAction: 'input_double_click_action',
};

/** 设置变更广播事件名:主窗写库成功后广播,输入栏收到即重载(见 use-input-settings) */
export const INPUT_SETTINGS_CHANGED_EVENT = 'input-settings-changed';

export const INPUT_DEFAULTS: InputSettings = {
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

function pick(raw: Record<string, string | null>, field: keyof InputSettings): string | null {
  return raw[INPUT_KEYS[field]] ?? null;
}

/** 键存在且值为 'true' 才是真;缺失与空串回退默认值 */
function parseBool(raw: Record<string, string | null>, field: BoolField): boolean {
  const value = pick(raw, field);
  if (value === null || value === '') return INPUT_DEFAULTS[field];
  return value === 'true';
}

function parseNum(
  raw: Record<string, string | null>,
  field: NumField,
  clamp: (n: number) => number,
): number {
  const value = pick(raw, field);
  if (value === null) return INPUT_DEFAULTS[field];
  const text = value.trim();
  if (!NUMBER_RE.test(text)) return INPUT_DEFAULTS[field];
  return clamp(Number(text));
}

export function parseInputSettings(raw: Record<string, string | null>): InputSettings {
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

export function serializeInputSetting<K extends keyof InputSettings>(
  key: K,
  value: InputSettings[K],
): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(Math.round(value));
  return String(value);
}

export async function loadInputSettings(): Promise<InputSettings> {
  const fields = Object.keys(INPUT_KEYS) as (keyof InputSettings)[];
  const values = await Promise.all(fields.map((f) => api.getSetting(INPUT_KEYS[f])));
  const raw: Record<string, string | null> = {};
  fields.forEach((f, i) => {
    raw[INPUT_KEYS[f]] = values[i];
  });
  return parseInputSettings(raw);
}

export async function saveInputSetting<K extends keyof InputSettings>(
  key: K,
  value: InputSettings[K],
): Promise<void> {
  await api.setSetting(INPUT_KEYS[key], serializeInputSetting(key, value));
}

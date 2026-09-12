// 启动与托盘的设置键(input_autostart / input_startup_show)的解析、序列化与 IO。
// 纯逻辑放这里便于单测:非法或缺失值一律回退默认(见 brief 的 parseStartupSettings 测试)。
import { api } from './api';

/** 启动时显示什么:输入栏(默认)或仅托盘 */
export type StartupShow = 'input-bar' | 'tray-only';

export interface StartupSettings {
  /** 期望的开机启动状态(系统真实值由 Rust 命令 get_autostart_status 读取) */
  autostart: boolean;
  startupShow: StartupShow;
}

export const STARTUP_KEYS: Record<keyof StartupSettings, string> = {
  autostart: 'input_autostart',
  startupShow: 'input_startup_show',
};

export const STARTUP_DEFAULTS: StartupSettings = {
  autostart: false,
  startupShow: 'input-bar',
};

/** startupShow 的白名单:只有这两个值生效,其余(含空串、未知字符串)回退默认 */
export const STARTUP_SHOW_VALUES: StartupShow[] = ['input-bar', 'tray-only'];

/** 期望值与系统实际值是否一致;不一致表示注册表被外部改动,界面应提示"需要修复" */
export type AutostartStatus = 'off' | 'on' | 'needs-repair';

function pick(raw: Record<string, string | null>, key: keyof StartupSettings): string | null {
  return raw[STARTUP_KEYS[key]] ?? null;
}

export function parseStartupSettings(raw: Record<string, string | null>): StartupSettings {
  const autostart = pick(raw, 'autostart');
  const show = pick(raw, 'startupShow');
  return {
    // 键存在且为 'true' 才是真;缺失与空串回退默认(与 input-settings 的布尔解析一致)
    autostart: autostart === null || autostart === '' ? STARTUP_DEFAULTS.autostart : autostart === 'true',
    startupShow: show === 'tray-only' ? 'tray-only' : STARTUP_DEFAULTS.startupShow,
  };
}

export function serializeStartupSetting<K extends keyof StartupSettings>(
  key: K,
  value: StartupSettings[K],
): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** 期望与实际一致 -> off/on;不一致 -> needs-repair(纯函数,界面据此显示修复入口) */
export function resolveAutostartStatus(wanted: boolean, actual: boolean): AutostartStatus {
  if (wanted === actual) return wanted ? 'on' : 'off';
  return 'needs-repair';
}

export async function loadStartupSettings(): Promise<StartupSettings> {
  const fields = Object.keys(STARTUP_KEYS) as (keyof StartupSettings)[];
  const values = await Promise.all(fields.map((f) => api.getSetting(STARTUP_KEYS[f])));
  const raw: Record<string, string | null> = {};
  fields.forEach((f, i) => {
    raw[STARTUP_KEYS[f]] = values[i];
  });
  return parseStartupSettings(raw);
}

export async function saveStartupSetting<K extends keyof StartupSettings>(
  key: K,
  value: StartupSettings[K],
): Promise<void> {
  await api.setSetting(STARTUP_KEYS[key], serializeStartupSetting(key, value));
}

/** 读取注册表里的真实自启状态(由 Rust 调用 autostart 插件,前端不直接依赖插件权限) */
export async function loadAutostartActual(): Promise<boolean> {
  const status = await api.getAutostartStatus();
  return status.enabled;
}

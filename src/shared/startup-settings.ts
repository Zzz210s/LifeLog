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

/** 期望值与系统实际值是否一致;不一致表示注册表被外部改动或路径已失效,界面应提示"需要修复" */
export type AutostartStatus = 'off' | 'on' | 'needs-repair';

/** 注册表里的真实自启状态(由 Rust 读系统得到,前端不直接依赖插件权限) */
export interface AutostartActual {
  /** Run 值存在且未被任务管理器禁用 */
  enabled: boolean;
  /** Run 值里的可执行文件路径是否就是当前进程路径(换过安装位置后为 false) */
  pathOk: boolean;
}

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
  // 参数只为类型收窄(K 决定 value 的类型),运行期不读 key —— 下划线前缀避免未用告警
  _key: K,
  value: StartupSettings[K],
): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * 期望与实际一致 -> off/on;不一致 -> needs-repair(纯函数,界面据此显示修复入口)。
 * 期望关闭时只看 enabled(值删掉就是目标态,值里的路径已无意义);
 * 期望开启时路径也必须指向当前可执行文件 —— 只判存在会漏掉「注册表里残留旧安装路径」的情况:
 * 那种状态下 is_enabled() 仍为 true,界面会显示「已开启」而永远不给修复入口。
 */
export function resolveAutostartStatus(wanted: boolean, actual: AutostartActual): AutostartStatus {
  if (wanted) return actual.enabled && actual.pathOk ? 'on' : 'needs-repair';
  return actual.enabled ? 'needs-repair' : 'off';
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

/** 读取注册表里的真实自启状态(由 Rust 调用 autostart 插件与注册表,前端不直接依赖插件权限)。
 *  注意 IPC 返回的是 Rust 字段名 path_ok(snake_case 直传),这里再转成本模块的 camelCase */
export async function loadAutostartActual(): Promise<AutostartActual> {
  const status = await api.getAutostartStatus();
  return { enabled: status.enabled, pathOk: status.path_ok };
}

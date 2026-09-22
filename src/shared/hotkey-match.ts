/**
 * 应用内快捷键匹配(主窗 keydown -> 是否命中存储的加速键)。
 *
 * 规范化复用 hotkey-display 的 `partsFromEvent` / `normalizeParts`(规则与 Rust
 * `src-tauri/src/hotkey_spec.rs` 一致:1-3 个键、单键仅 F1-F24、仅一个主键 —— 于是
 * 2-3 键的组合必然含修饰键),输出小写规范名(ctrl+alt+shift+super+主键)—— 与库里的存储值同口径;
 * 界面文案用 hotkey-display 的 `formatAccelerator`。
 *
 * 向量:`fixtures/hotkey-spec.json`(TS 侧真读;Rust 镜像留后续任务)。
 */
import { normalizeAccelerator, normalizeParts, partsFromEvent } from './hotkey-display';
import type { KeyEventLike } from './hotkey-display';

export type { KeyEventLike };

/** 应用内快捷键的两个用途(设置页两行录制器、主窗两个入口) */
export type AppHotkeyKind = 'palette' | 'quickOpen';

/**
 * 存储键名(设计 §3.6):与 `DEFAULT_APP_HOTKEYS` 同处一源,避免键名/默认值两处真源
 * (T3 审查 Minor 6)。写法照 HOTKEY_KEY(`hotkey-display.ts`)。
 */
export const APP_HOTKEY_KEYS = Object.freeze({
  palette: 'main_palette_hotkey',
  quickOpen: 'main_quick_open_hotkey',
} as const);

/**
 * 应用内快捷键默认值(设计 §3.6);改键后以 settings 值为准(T7)。
 * 与 `input_hotkey`(系统级全局热键)无关,这两个不注册系统热键。
 */
export const DEFAULT_APP_HOTKEYS: Readonly<Record<AppHotkeyKind, string>> = Object.freeze({
  palette: 'ctrl+shift+p',
  quickOpen: 'ctrl+p',
});

/** 事件 -> 规范化加速键;非法组合(只按修饰键、单普通键等)返回 null */
export function acceleratorFromEvent(event: KeyEventLike): string | null {
  return normalizeParts(partsFromEvent(event));
}

/**
 * 事件是否命中存储的加速键(逐字符相等,故"多余修饰键"不会命中)。
 * 存储值缺失/非法一律不命中 —— 默认值由调用方按 DEFAULT_APP_HOTKEYS 补。
 */
export function matchesHotkey(event: KeyEventLike, stored: string | null | undefined): boolean {
  if (stored === null || stored === undefined) return false;
  const want = normalizeAccelerator(stored);
  const got = acceleratorFromEvent(event);
  return want !== null && got !== null && want === got;
}

/**
 * 读取**真正生效**的应用内快捷键:缺失或非法一律回退 `DEFAULT_APP_HOTKEYS`
 * (照抄同型 `effectiveAccelerator`)。调用点不许自行兜底 —— `matchesHotkey` 对非法值
 * 一律不命中,散落的兜底一旦漏写就是「改坏一次 = 快捷键永久失效」(T3 审查 Minor 7)。
 */
export function effectiveAppHotkey(raw: string | null | undefined, kind: AppHotkeyKind): string {
  if (raw === null || raw === undefined) return DEFAULT_APP_HOTKEYS[kind];
  return normalizeAccelerator(raw) ?? DEFAULT_APP_HOTKEYS[kind];
}

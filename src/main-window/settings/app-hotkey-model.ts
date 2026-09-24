/**
 * 设置页「快捷键」分区(两个**应用内**快捷键)的元数据与读写。
 *
 * 写入一律走 Rust 命令 `set_app_hotkey`(规范化 + 与系统级键/另一个应用内键的冲突检查),
 * 这里**不复制任何校验规则** —— 前端只负责显示 Rust 给的中文原因(与输入栏那一行同做法)。
 * 系统级(输入栏唤起键)在「输入栏」分区,两处作用域不同,不混在一行里。
 */
import { api } from '../../shared/api';
import { APP_HOTKEY_KEYS, DEFAULT_APP_HOTKEYS } from '../../shared/hotkey-match';
import type { AppHotkeyKind } from '../../shared/hotkey-match';
import { APP_HOTKEYS_CHANGED } from '../shell/use-app-hotkeys';

export interface AppHotkeyRow {
  kind: AppHotkeyKind;
  /** settings 表里的键名(与 Rust `app_hotkey::KINDS` 同源) */
  key: string;
  label: string;
  hint: string;
  /** 录制按钮的 aria-label:全局那行占用了 `button[aria-label="录制快捷键"]`(命令 hotkey.edit 定位它),这里必须不同名 */
  ariaLabel: string;
}

const ROWS: AppHotkeyRow[] = [
  {
    kind: 'quickOpen',
    key: APP_HOTKEY_KEYS.quickOpen,
    label: '快速打开笔记',
    hint: '应用内快捷键:主窗按一下聚焦输入框并预填 @,输入关键词即搜笔记',
    ariaLabel: '录制快捷键:快速打开笔记',
  },
  {
    kind: 'palette',
    key: APP_HOTKEY_KEYS.palette,
    label: '命令面板',
    hint: '应用内快捷键:主窗按一下聚焦输入框并预填 >,输入命令名即执行',
    ariaLabel: '录制快捷键:命令面板',
  },
];

/** 两行元数据(每次返回浅拷贝,调用方改不到真源) */
export function appHotkeyRows(): AppHotkeyRow[] {
  return ROWS.map((row) => ({ ...row }));
}

/** 写一个应用内快捷键:成功返回规范化值并广播(主窗立刻用新键),失败抛中文原因 */
function write(kind: AppHotkeyKind, raw: string): Promise<string> {
  return api.setAppHotkey(kind, raw).then((saved) => {
    notifyAppHotkeysChanged();
    return saved;
  });
}

/** 录制保存 */
export function saveAppHotkey(kind: AppHotkeyKind, raw: string): Promise<string> {
  return write(kind, raw);
}

/** 清除自定义(库里留空串):读取侧 effectiveAppHotkey 回退默认键 */
export function clearAppHotkey(kind: AppHotkeyKind): Promise<string> {
  return write(kind, '');
}

/** 恢复默认:把默认键**显式写回**库(与清除的区别:以后默认值若变化,清除会跟随、写回不会) */
export function resetAppHotkey(kind: AppHotkeyKind): Promise<string> {
  return write(kind, DEFAULT_APP_HOTKEYS[kind]);
}

/**
 * 保存成功后广播 `lifelog://app-hotkeys-changed`:主窗 `useAppHotkeys` 收到即重读缓存,
 * 新键**立刻**生效,不必重启(T6 定下的接缝)。事件只是加速通道 —— 丢失时窗口重新获得焦点
 * 仍会重读,故这里不做任何失败处理。
 */
export function notifyAppHotkeysChanged(): void {
  window.dispatchEvent(new Event(APP_HOTKEYS_CHANGED));
}

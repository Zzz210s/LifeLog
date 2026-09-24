/**
 * 主窗应用内快捷键:命中即**聚焦唯一输入框并预填前缀**(Task 7 起不再开关浮层)。
 * 键位不变,行为变了:`Ctrl+P` -> `@`(打开笔记),`Ctrl+Shift+P` -> `>`(执行命令)。
 * 快捷键读取一律走 `effectiveAppHotkey`(缺失/非法回退 `DEFAULT_APP_HOTKEYS`,调用点不再各自兜底,
 * T3 审查 Minor 7);`e.repeat` 一律忽略 —— 按住快捷键不能反复触发(T3 审查 Minor 8)。
 * 从 `use-palette.ts` 拆出:两个 hook 各自单一职责,且两份都守住行数红线(项目规则 #10)。
 */
import { useEffect, useRef } from 'react';
import { effectiveAppHotkey, matchesHotkey } from '../../shared/hotkey-match';

export interface AppHotkeyReading {
  /** 存储的原始值,可能缺失/非法;null/undefined 表示未设置 */
  palette?: string | null;
  quickOpen?: string | null;
}

export interface PaletteHotkeysOptions {
  /** 命中即预填该前缀(':>' 命令 / '@' 打开笔记);聚焦与写值都在 shell 层(统一输入框的 controller) */
  onPrefill: (prefix: string) => void;
  /** 读取存储值(读不到即用默认键);每次按键现读,改键后不必重挂监听 */
  read?: () => AppHotkeyReading;
  target?: Window;
}

export function usePaletteHotkeys(options: PaletteHotkeysOptions): void {
  const latest = useRef(options);
  latest.current = options; // 回调/读取器总是最新,避免每次 render 重挂监听
  const { target } = options;
  useEffect(() => {
    const win = target ?? window;
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      const current = latest.current;
      const stored = current.read?.() ?? {};
      if (matchesHotkey(event, effectiveAppHotkey(stored.palette, 'palette'))) {
        event.preventDefault();
        current.onPrefill('>');
        return;
      }
      if (matchesHotkey(event, effectiveAppHotkey(stored.quickOpen, 'quickOpen'))) {
        event.preventDefault();
        current.onPrefill('@');
      }
    };
    win.addEventListener('keydown', onKey);
    return () => win.removeEventListener('keydown', onKey);
  }, [target]);
}

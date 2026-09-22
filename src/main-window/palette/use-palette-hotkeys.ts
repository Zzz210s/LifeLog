/**
 * 主窗应用内快捷键:命中则开浮层(命令面板 '>' / 快速打开笔记 '')。
 * 快捷键读取一律走 `effectiveAppHotkey`(缺失/非法回退 `DEFAULT_APP_HOTKEYS`,调用点不再各自兜底,
 * T3 审查 Minor 7);`e.repeat` 一律忽略 —— 按住快捷键不能反复开(T3 审查 Minor 8)。
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
  onTrigger: (prefix: string) => void;
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
        current.onTrigger('>');
        return;
      }
      if (matchesHotkey(event, effectiveAppHotkey(stored.quickOpen, 'quickOpen'))) {
        event.preventDefault();
        current.onTrigger('');
      }
    };
    win.addEventListener('keydown', onKey);
    return () => win.removeEventListener('keydown', onKey);
  }, [target]);
}

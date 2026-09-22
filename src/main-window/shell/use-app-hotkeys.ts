/**
 * 主窗两个**应用内快捷键**(命令面板 / 快速打开)的读取与刷新(T6 接线;T7 提供录制器写入)。
 *
 * - 真源是 settings KV(`main_palette_hotkey` / `main_quick_open_hotkey`,设计 §3.6);
 *   `usePaletteHotkeys` 的 read 是同步的(每次按键现读),所以这里缓存一份、按键时同步返回。
 * - 刷新时机:挂载、窗口重新获得焦点、以及 `lifelog://app-hotkeys-changed` 事件
 *   (T7 的录制器保存成功后派发它即可让新键**立刻**生效,不必重启)。
 * - 缺省/非法值由 `effectiveAppHotkey` 兜底(不在调用点各自写默认值)。
 */
import { useCallback, useEffect, useRef } from 'react';
import { api } from '../../shared/api';
import { APP_HOTKEY_KEYS } from '../../shared/hotkey-match';
import type { AppHotkeyReading } from '../palette/use-palette-hotkeys';

/** T7 录制器保存后派发它(T6 只监听;事件名与键名一样是两侧约定的接缝) */
export const APP_HOTKEYS_CHANGED = 'lifelog://app-hotkeys-changed';

export function useAppHotkeys(): () => AppHotkeyReading {
  const cache = useRef<AppHotkeyReading>({});

  const reload = useCallback(() => {
    void Promise.all([
      api.getSetting(APP_HOTKEY_KEYS.palette),
      api.getSetting(APP_HOTKEY_KEYS.quickOpen),
    ])
      .then(([palette, quickOpen]) => {
        cache.current = { palette, quickOpen };
      })
      .catch(() => {
        /* 读不到 = 用默认键(effectiveAppHotkey 兜底),不阻断主窗 */
      });
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener('focus', reload);
    window.addEventListener(APP_HOTKEYS_CHANGED, reload);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener(APP_HOTKEYS_CHANGED, reload);
    };
  }, [reload]);

  return useCallback(() => cache.current, []);
}

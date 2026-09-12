// 主窗订阅托盘「设置」菜单(事件名 open-settings,由 Rust 的 tray.rs 发送)。
// 托盘在该事件之前已把主窗显示出来,这里只负责把视图切到设置页。
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

export const OPEN_SETTINGS_EVENT = 'open-settings';

export function useOpenSettings(onOpen: () => void, onError?: (message: string) => void): void {
  const latest = useRef({ onOpen, onError });
  latest.current = { onOpen, onError };

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen(OPEN_SETTINGS_EVENT, () => latest.current.onOpen())
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch((e) => latest.current.onError?.('托盘设置菜单订阅失败: ' + String(e)));
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
}

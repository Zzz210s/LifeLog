// 主窗订阅两路「切到设置页」意图:
// ①托盘「设置」时窗口已存在 -> Rust 直接发 open-settings 事件;
// ②窗口是这次才新建的 -> 事件早于本订阅发出,改为 mount 时取用 Rust 的 pending 标志(取走即清空)。
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../shared/api';

export const OPEN_SETTINGS_EVENT = 'open-settings';

/** mount 取用判定:只有布尔 true 才切设置页(缺失/false/异常载荷都不动) */
export function shouldOpenOnPending(pending: unknown): boolean {
  return pending === true;
}

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
    void api
      .takePendingOpenSettings()
      .then((pending) => {
        if (cancelled) return;
        if (shouldOpenOnPending(pending)) latest.current.onOpen();
      })
      .catch((e) => latest.current.onError?.('读取待打开意图失败: ' + String(e)));
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
}

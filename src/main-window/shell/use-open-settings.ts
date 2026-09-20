// 主窗订阅两路「切到设置页」意图:
// ①托盘「设置」时窗口已存在 -> Rust 直接发 open-settings 事件;
// ②窗口是这次才新建(或页面正在重载/还没 mount)-> 事件早于本订阅发出,改为取用 Rust 的
//   pending 标志(取走即清空)。
// Rust 侧对「已存在窗口」是 emit + 置 pending 双通道,所以**事件到达时也要消费一次** pending:
// 不消费就会把残留留给下一次普通「打开主窗口」而误切到设置页(2026-09-21 回看 I4)。
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../../shared/api';

export const OPEN_SETTINGS_EVENT = 'open-settings';

/** mount 取用判定:只有布尔 true 才切设置页(缺失/false/异常载荷都不动) */
export function shouldOpenOnPending(pending: unknown): boolean {
  return pending === true;
}

/**
 * 事件通道到达时补消费一次 pending(与 mount 取用同一份标志):
 * 取用失败只影响兜底,不阻断切页,故这里吞掉异常。
 */
export function consumePendingAfterEvent(takePending: () => Promise<unknown>): void {
  void takePending().catch(() => undefined);
}

export function useOpenSettings(onOpen: () => void, onError?: (message: string) => void): void {
  const latest = useRef({ onOpen, onError });
  latest.current = { onOpen, onError };

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen(OPEN_SETTINGS_EVENT, () => {
      consumePendingAfterEvent(() => api.takePendingOpenSettings());
      latest.current.onOpen();
    })
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

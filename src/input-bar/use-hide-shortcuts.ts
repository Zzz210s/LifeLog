import { useCallback, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../shared/api';
import { canClose, type LockState } from '../shared/input-lock';

/**
 * 输入栏隐藏接线:页面自己发起的隐藏(Esc / 双击)先 flush 视图状态再隐藏,
 * Rust 侧隐藏(热键/托盘/失焦)由 input-hiding 事件兜底最后一次 flush。
 * 从 InputBar.tsx 拆出以守住 200 行上限。
 */
export function useHideShortcuts(opts: {
  lock: LockState;
  flushView: () => void;
  doubleClickAction: 'hide' | 'none';
}): { onDoubleClick: () => void } {
  const { lock, flushView, doubleClickAction } = opts;

  // 页面自己发起的隐藏(Esc/双击)先 flush 视图状态再隐藏:窗口隐藏后页面计时器可能被冻结,
  // 节流中的透明度就永远落不了库;Rust 侧隐藏(热键/托盘/失焦)由下面的 input-hiding 事件兜底。
  const hideNow = useCallback(() => {
    flushView();
    void api.hideInputBar();
  }, [flushView]);

  // Rust 侧隐藏(热键/托盘/失焦自动隐藏)在 w.hide() 前会发出 input-hiding:
  // hide() 不触发 onFocusChanged(实测),隐藏后页面计时器还可能被冻结,页面自己发起的
  // 隐藏(Esc/双击)已由 hideNow 先 flush,热键/托盘路径靠这个事件补上最后一次 flush。
  // 残留风险:事件送达与页面处理都是异步的,页面若已被挂起仍可能漏掉(非 100% 可靠)。
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen('input-hiding', () => flushView())
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch(() => {}); // 订阅失败不阻断隐藏流程
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [flushView]);

  // 窗口级 Esc(焦点在 BODY 时 textarea 收不到):锁定判据不变,只负责隐藏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return; // 输入法组合中不抢 Esc
      e.preventDefault();
      if (!canClose(lock)) return; // 阻止关闭:Esc 无效(托盘菜单仍可隐藏)
      hideNow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lock, hideNow]);

  const onDoubleClick = useCallback(() => {
    if (doubleClickAction !== 'hide' || !canClose(lock)) return;
    hideNow();
  }, [doubleClickAction, lock, hideNow]);

  return { onDoubleClick };
}

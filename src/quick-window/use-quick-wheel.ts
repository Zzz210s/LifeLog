import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
import {
  clampOpacity,
  clampScale,
  nextOpacity,
  nextScale,
  resetView,
  wheelAction,
  wheelDirection,
} from '../shared/quick-scale';
import type { QuickSettings } from '../shared/quick-settings';

/** 透明度落库节流:连续 Ctrl+滚轮只写最后一次 */
const PERSIST_MS = 200;
/** 缩放会改变窗口的 CSS 空间,高度要按新比例重算(等 IPC 落地后再测) */
const RESYNC_MS = 120;

const noop = () => {};

/**
 * 快捷窗视图接线:普通滚轮缩放、Ctrl+滚轮调透明度、中键恢复(缩放 100% + 默认透明度)。
 * 透明度落库 quick_opacity(节流);缩放走 Rust apply_scale(尺寸 + webview zoom 一并落),
 * IPC 串行化避免多个缩放交错落地,命令失败时回滚本地基准并提示。
 */
export function useQuickWheel(opts: {
  settings: QuickSettings;
  onResized: () => void;
  onError?: (message: string) => void;
}) {
  const { settings, onResized, onError = noop } = opts;
  const [opacity, setOpacity] = useState(settings.defaultOpacity);
  const opacityRef = useRef(opacity);
  const zoomRef = useRef(1);
  /** 窗口上真实生效的系数:命令成功后推进,失败时据此回滚 */
  const appliedRef = useRef(1);
  const scaleSeq = useRef(0);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const persistTimer = useRef<number | null>(null);
  const resyncTimer = useRef<number | null>(null);

  // 设置重载(含窗口重新显示)时读回当前透明度与缩放;quick_opacity 未设过则用默认透明度
  useEffect(() => {
    let alive = true;
    void Promise.all([api.getSetting('quick_opacity'), api.getSetting('quick_zoom')])
      .then(([rawOpacity, rawZoom]) => {
        if (!alive) return;
        const o =
          rawOpacity === null || rawOpacity.trim() === ''
            ? clampOpacity(settings.defaultOpacity)
            : clampOpacity(Number(rawOpacity));
        opacityRef.current = o;
        setOpacity(o);
        zoomRef.current =
          rawZoom === null || rawZoom.trim() === '' ? 1 : clampScale(Number(rawZoom));
        appliedRef.current = zoomRef.current;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings]);

  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
    },
    [],
  );

  const applyOpacity = useCallback((value: number) => {
    opacityRef.current = value;
    setOpacity(value);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void api.setSetting('quick_opacity', String(Math.round(value))).catch(() => {});
    }, PERSIST_MS);
  }, []);

  const applyScale = useCallback(
    (value: number) => {
      zoomRef.current = value; // 立即生效:连续滚轮按新基准继续,视觉不等 IPC
      const id = ++scaleSeq.current;
      // 串行化:IPC 按调用顺序排队,避免多个 set_quick_scale 在 Rust 侧交错落地
      pending.current = pending.current
        .then(() => api.setQuickScale(value))
        .then(() => {
          appliedRef.current = value;
          if (id !== scaleSeq.current) return; // 有更新的意图在排队,由它负责重算高度
          if (resyncTimer.current) clearTimeout(resyncTimer.current);
          resyncTimer.current = window.setTimeout(onResized, RESYNC_MS);
        })
        .catch(() => {
          if (id !== scaleSeq.current) return; // 不是最新意图:留给它结算
          // 命令失败时 quick_zoom 未被改写:回滚本地基准到真实生效值,并提示(不静默)
          zoomRef.current = appliedRef.current;
          onError('缩放失败,已回滚');
        });
    },
    [onResized, onError],
  );

  // 滚轮:手动注册为非 passive(React 的 wheel 监听是被动的,preventDefault 会失效)
  useEffect(() => {
    // 目标处于可滚动容器内时,普通滚轮优先滚内容(既有行为);Ctrl+滚轮一律调透明度
    const inScrollable = (t: EventTarget | null): boolean => {
      for (let el = t as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight) return true;
      }
      return false;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      const dir = wheelDirection(e.deltaY);
      if (wheelAction(e) === 'opacity') {
        e.preventDefault();
        applyOpacity(nextOpacity(opacityRef.current, dir, settings.opacityStep));
        return;
      }
      if (inScrollable(e.target)) return;
      e.preventDefault();
      const next = nextScale(zoomRef.current, dir, settings.zoomStep);
      if (next === zoomRef.current) return; // 已到边界,不再打扰 Rust
      applyScale(next);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [applyOpacity, applyScale, settings.opacityStep, settings.zoomStep]);

  /** 中键(button === 1):一次性恢复「缩放 100% + 默认透明度」并落库 */
  const onMiddleDown = useCallback(
    (e: { button: number; preventDefault: () => void }): boolean => {
      if (e.button !== 1) return false;
      e.preventDefault(); // 阻止中键自动滚动
      const view = resetView(settings);
      applyOpacity(view.opacity);
      applyScale(view.scale);
      return true;
    },
    [applyOpacity, applyScale, settings],
  );

  return { opacity, onMiddleDown };
}

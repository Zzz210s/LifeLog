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

/**
 * 快捷窗视图接线:普通滚轮缩放、Ctrl+滚轮调透明度、中键恢复(缩放 100% + 默认透明度)。
 * 透明度落库 quick_opacity(节流);缩放走 Rust apply_scale(尺寸 + webview zoom 一并落)。
 */
export function useQuickWheel(opts: { settings: QuickSettings; onResized: () => void }) {
  const { settings, onResized } = opts;
  const [opacity, setOpacity] = useState(settings.defaultOpacity);
  const opacityRef = useRef(opacity);
  const zoomRef = useRef(1);
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
      zoomRef.current = value;
      void api
        .setQuickScale(value)
        .then(() => {
          if (resyncTimer.current) clearTimeout(resyncTimer.current);
          resyncTimer.current = window.setTimeout(onResized, RESYNC_MS);
        })
        .catch(() => {});
    },
    [onResized],
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

import { useCallback, useEffect } from 'react';
import {
  nextOpacity,
  nextScale,
  resetView,
  wheelAction,
  wheelDirection,
} from '../shared/quick-scale';
import type { QuickSettings } from '../shared/quick-settings';
import { useQuickViewStore } from './use-quick-view-store';

/**
 * 快捷窗视图接线:普通滚轮缩放、Ctrl+滚轮调透明度、中键恢复(缩放 100% + 默认透明度)。
 * 本地值、节流落库与回读防覆盖都在 use-quick-view-store(见其文档)。
 */
export function useQuickWheel(opts: {
  settings: QuickSettings;
  onResized: () => void;
  onError?: (message: string) => void;
}) {
  const { settings, onResized, onError } = opts;
  const { opacity, opacityRef, zoomRef, applyOpacity, applyScale, flushOpacity } =
    useQuickViewStore({ settings, onResized, onError });

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

  return { opacity, onMiddleDown, flushView: flushOpacity };
}

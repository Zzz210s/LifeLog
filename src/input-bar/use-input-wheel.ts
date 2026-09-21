import { useCallback, useEffect } from 'react';
import { canScrollOnWheel } from '../shared/input-gestures';
import {
  nextOpacity,
  nextScale,
  resetView,
  wheelAction,
  wheelDirection,
} from '../shared/input-scale';
import type { InputSettings } from '../shared/input-settings';
import { useInputViewStore } from './use-input-view-store';

/**
 * 输入栏视图接线:普通滚轮缩放、Ctrl+滚轮调透明度、中键恢复(缩放 100% + 默认透明度)。
 * 本地值、节流落库与回读防覆盖都在 use-input-view-store(见其文档)。
 */
export function useInputWheel(opts: {
  settings: InputSettings;
  onResized: () => void;
  onError?: (message: string) => void;
}) {
  const { settings, onResized, onError } = opts;
  const { opacity, opacityRef, zoomRef, applyOpacity, applyScale, flushOpacity } =
    useInputViewStore({ settings, onResized, onError });

  // 滚轮:手动注册为非 passive(React 的 wheel 监听是被动的,preventDefault 会失效)
  useEffect(() => {
    // 落点处于**真能自己滚**的容器内时,普通滚轮优先滚内容。判定两条缺一不可:
    // ① computed overflow-y 为 auto/scroll(overflow: visible 的祖先不算 —— 输入栏根就是 visible,
    //    只判溢出会让整个输入栏被当成“列表在滚”,缩放被静默吞掉,2026-09-21 复审 A2);
    // ② 确实溢出且带容差(输入框撑满窗口,取整残差会让 `>` 恒真)。
    // `#` 补全列表按设计**没有**内部滚动(候选上限 = 列表最大行数,见 SUGGEST_MAX_ROWS),
    // 故它不会命中这条分支:滚轮落在列表上仍然缩放输入栏,这是既有 spec,不是缺陷。
    const inScrollable = (t: EventTarget | null): boolean => {
      for (let el = t as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (canScrollOnWheel(cs.overflowY, el.scrollHeight, el.clientHeight)) return true;
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

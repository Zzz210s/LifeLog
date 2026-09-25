/**
 * 引导的运行时:解析锚点(回退链)-> 测量 -> 订阅重算。
 *
 * 两条判据在这里落地(设计 3.3 / 3.4):
 * - `findAnchor` 要求**非零矩形**:display:none / 还没渲染的节点不算命中 —— 只判存在会把主窗
 *   停在设置页时的 hidden 节点当命中,洞口成了 0x0 的假框;
 * - 首次测得「一步都显示不出来」时**不写标记**:先等两帧重试(主窗首次显示有布局稳定期),
 *   仍全缺才交回 `onUnavailable`(调用方只关闭、不写标记,下次启动再试)。只有用户动作
 *   (完成 / 跳过 / Esc),或「确实显示过至少一步之后才全缺」,才算走完 -> 调用方写标记。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TUTORIAL_STEPS } from './steps';
import type { TutorialStep } from './steps';
import { dropMissing, exitTutorial, initialTutorial, nextStep } from './tutorial-model';
import type { TutorialState } from './tutorial-model';
import { holeRect } from './tutorial-layout';
import type { Rect } from './tutorial-layout';

/** 首次测量全缺时的重试帧数(两帧,设计 3.4) */
export const ANCHOR_RETRIES = 2;

export interface TutorialHandlers {
  /** 重试后一步都显示不出来:调用方**只关闭、不写标记** */
  onUnavailable?: () => void;
  /** 当前步需要前置动作(显示侧栏):走应用状态入口,不直接改 DOM;测量在它之后 */
  onShowSidebar?: () => void;
}

/**
 * 按回退链找第一个**真的能显示**的节点:必须非零矩形。
 * 只判存在会把 display:none 的节点(主窗停在设置页时 StreamView 仍挂载、只是 hidden)当命中,
 * 于是洞口量成 0x0、气泡贴着一个不存在的框。
 */
export function findAnchor(selectors: string[]): Element | null {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** 某一步是否有可显示的锚点(与 findAnchor 同一判据,回退链与重试共用) */
export function anchorFound(step: TutorialStep): boolean {
  return findAnchor(step.selectors) !== null;
}

export interface Tutorial {
  state: TutorialState;
  step: TutorialStep;
  /** 洞口矩形(null = 还没量到:覆盖层先整屏压暗) */
  rect: Rect | null;
  advance: () => void;
  exit: () => void;
}

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

export function useTutorial(open: boolean, handlers: TutorialHandlers = {}): Tutorial {
  const [state, setState] = useState<TutorialState>(initialTutorial);
  const [rect, setRect] = useState<Rect | null>(null);
  /** 「确实显示过至少一步」:只有它为真,全缺才算走完;否则是"还没渲染出来" */
  const shown = useRef(false);
  /** 回调放进 ref:调用方常传内联函数,直接进依赖会让解析 effect 每次渲染重跑 */
  const cb = useRef<TutorialHandlers>({});
  const step = TUTORIAL_STEPS[state.index];

  useEffect(() => {
    cb.current = handlers;
  });

  // 开 / 换步时重新解析:掉过没有锚点的步骤;一步都显示不出来时先重试,再交回 onUnavailable
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const attempt = (left: number): void => {
      if (!alive) return;
      const fixed = dropMissing(state, TUTORIAL_STEPS, anchorFound);
      if (fixed.open) {
        shown.current = true;
        if (TUTORIAL_STEPS[fixed.index].before === 'show-sidebar') cb.current.onShowSidebar?.();
        setState((s) => (s.open === fixed.open && s.index === fixed.index ? s : fixed));
        return;
      }
      // 从当前步往后一步都解析不出锚点
      if (shown.current) {
        if (state.open) setState(exitTutorial()); // 显示过至少一步 => 算走完(调用方写标记)
        return;
      }
      if (left > 0) {
        requestAnimationFrame(() => attempt(left - 1));
        return;
      }
      cb.current.onUnavailable?.(); // 一步都没显示过:只关闭,不写标记
    };
    attempt(ANCHOR_RETRIES);
    return () => {
      alive = false;
    };
  }, [open, state]);

  // 测量:两帧 rAF 后取洞口(首次显示有布局稳定期);resize / scroll(捕获:侧栏与流容器各自滚)
  // / ResizeObserver 三处重算
  useEffect(() => {
    if (!open || !state.open) return;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    const measure = (): void => {
      const el = findAnchor(step.selectors);
      const next = el === null ? null : holeRect(el.getBoundingClientRect());
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    setRect(null); // 换步先清空:别让上一步的洞口留在屏幕上
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(measure);
    });
    const onLayout = (): void => measure();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onLayout);
      const el = findAnchor(step.selectors);
      if (el !== null) ro.observe(el);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
      ro?.disconnect();
    };
  }, [open, state.open, step]);

  const advance = useCallback(() => setState((s) => nextStep(s, TUTORIAL_STEPS)), []);
  const exit = useCallback(() => setState((s) => (s.open ? exitTutorial() : s)), []);
  // advance / exit 只改本地状态:写标记是调用方的事(见 TutorialHandlers 的语义)
  return { state, step, rect, advance, exit };
}

/**
 * 引导层:组装覆盖层 + 气泡,并管住模态的键盘与焦点。
 *
 * 出口语义(brief 硬约束 1):
 * - 完成 / 跳过 / Esc 都是**用户动作** -> 状态关闭 -> 这里调一次 `onExit`,写标记由调用方做;
 * - `onUnavailable`(重试后一步都显示不出来)只关闭、**不写标记** —— 它不经过 onExit。
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { TUTORIAL_STEPS } from './steps';
import { TutorialBubble } from './TutorialBubble';
import { TutorialOverlay } from './TutorialOverlay';
import { useTutorial } from './use-tutorial';

export interface TutorialLayerProps {
  open: boolean;
  /** 用户动作(完成 / 跳过 / Esc)结束:调用方写 `ui.tutorial_seen` 并关闭 */
  onExit: () => void;
  /** 重试后一步都显示不出来:调用方只关闭、不写标记,下次启动再试 */
  onUnavailable?: () => void;
  /** 第 3 步的前置动作:走「显示侧栏」同一处状态入口 */
  onShowSidebar?: () => void;
}

/** 气泡内可 Tab 到的元素(只有两个按钮,不引通用 focusable 选择器) */
const focusables = (box: HTMLElement | null): HTMLElement[] => [...(box?.querySelectorAll<HTMLElement>('button') ?? [])];

export function TutorialLayer(p: TutorialLayerProps): ReactNode {
  const bubble = useRef<HTMLDivElement | null>(null);
  /** 已调过 onExit(状态关闭只对应一次用户动作) */
  const fired = useRef(false);
  const { onExit, onUnavailable, onShowSidebar, open } = p;
  const { state, step, rect, advance, exit } = useTutorial(open, { onUnavailable, onShowSidebar });
  const live = open && state.open;

  // 状态关闭 = 走完 / 跳过 / Esc 三条用户动作:只调一次 onExit(onUnavailable 不经过这里)
  useEffect(() => {
    if (!open || state.open || fired.current) return;
    fired.current = true;
    onExit();
  }, [open, state.open, onExit]);

  // Esc 退出(等同跳过);组字中不拦(输入法候选窗也吃 Esc)
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.stopPropagation();
      e.preventDefault();
      exit();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [live, exit]);

  // 焦点锁在气泡内:进门聚焦,Tab 循环,焦点被抢走就拉回来 —— 引导期间打字不进输入框
  useEffect(() => {
    if (!live) return;
    bubble.current?.focus();
    const onTab = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const list = focusables(bubble.current);
      if (list.length === 0) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const back = at <= 0 ? list.length - 1 : at - 1;
      const next = at < 0 || at >= list.length - 1 ? 0 : at + 1;
      list[e.shiftKey ? back : next].focus();
    };
    const onFocusIn = (e: FocusEvent): void => {
      const box = bubble.current;
      if (box !== null && e.target instanceof Node && !box.contains(e.target)) box.focus();
    };
    window.addEventListener('keydown', onTab, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      window.removeEventListener('keydown', onTab, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [live, step]);

  if (!live) return null;
  return (
    <>
      <TutorialOverlay hole={rect} />
      <TutorialBubble
        step={step}
        index={state.index}
        total={TUTORIAL_STEPS.length}
        hole={rect}
        onNext={advance}
        onSkip={exit}
        bubbleRef={bubble}
      />
    </>
  );
}

import type { TutorialStep } from './steps';

export { TUTORIAL_SEEN_KEY, TUTORIAL_STEPS } from './steps';
export type { TutorialStep } from './steps';

export interface TutorialState { open: boolean; index: number }

/** 未看过 = 缺失或空串(空串让「清标记重看」不必删行) */
export function isSeen(value: string | null): boolean {
  return value === '1';
}

export function initialTutorial(): TutorialState {
  return { open: true, index: 0 };
}

/** 末步再前进 = 关闭(越界不前进);已关闭的状态原样返回(与 dropMissing 的守卫对称) */
export function nextStep(s: TutorialState, steps: TutorialStep[]): TutorialState {
  if (!s.open) return s;
  const last = steps.length - 1;
  return s.index >= last ? { open: false, index: s.index } : { open: true, index: s.index + 1 };
}

/** 跳过与走完共用同一条出口(标记由调用方写一次) */
export function exitTutorial(): TutorialState {
  return { open: false, index: 0 };
}

/**
 * 掉过锚点解析不出来的步骤:从当前位置往后找第一个可显示的;都没有则关闭。
 * 已关闭的状态原样返回 —— 关闭后 resize/scroll 仍会重算,这条守卫是「关掉不再弹回来」的防线。
 *
 * **写标记的判据不在这个函数里**(它只返回"当前该停在哪一步"):`{open:false}` 既可能是
 * "走完了"也可能是"一步都显示不出来",调用方不能只看它。真正的判据在 `use-tutorial.ts`:
 * 首次解析全缺 -> 先重试若干帧 -> 仍全缺才 `onUnavailable`(**不写标记**);只有用户动作
 * (完成/跳过/Esc),或"确实显示过至少一步之后才全缺",才走 `onExit` 写标记。
 */
export function dropMissing(
  s: TutorialState,
  steps: TutorialStep[],
  found: (step: TutorialStep) => boolean
): TutorialState {
  if (!s.open) return s;
  for (let i = s.index; i < steps.length; i++) if (found(steps[i])) return { open: true, index: i };
  return { open: false, index: s.index };
}

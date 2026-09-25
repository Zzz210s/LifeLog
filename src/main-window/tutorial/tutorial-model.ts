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

/** 末步再前进 = 关闭(越界不前进) */
export function nextStep(s: TutorialState, steps: TutorialStep[]): TutorialState {
  const last = steps.length - 1;
  return s.index >= last ? { open: false, index: s.index } : { open: true, index: s.index + 1 };
}

/** 跳过与走完共用同一条出口(标记由调用方写一次) */
export function exitTutorial(): TutorialState {
  return { open: false, index: 0 };
}

/** 掉过锚点解析不出来的步骤:从当前位置往后找第一个可显示的;都没有则关闭 */
export function dropMissing(
  s: TutorialState,
  steps: TutorialStep[],
  found: (step: TutorialStep) => boolean
): TutorialState {
  if (!s.open) return s;
  for (let i = s.index; i < steps.length; i++) if (found(steps[i])) return { open: true, index: i };
  return { open: false, index: s.index };
}

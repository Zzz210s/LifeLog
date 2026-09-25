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
 * 还有没有任何一步能显示(调用方用它区分「走完了」与「一步都显示不出来」)。
 *
 * 为什么需要:`dropMissing` 关闭时返回的 `{open:false}` 与「末步走完」**在形状上一样**,
 * 调用方只看 `state.open === false` 就写 `ui.tutorial_seen` 的话,一次「锚点还没渲染出来」的
 * 首次测量就会把标记写掉、用户什么也没看到。约定(见设计 3.3):
 *  - `found` 必须要求**非零矩形**(display:none / 未渲染的节点不算命中);
 *  - 首次测得「一步都没有」时**不要**写标记,等两帧重试(设计 3.4);
 *  - 只有用户动作(完成/跳过/Esc),或「确实显示过至少一步之后才全缺」,才写标记。
 */
export function hasDisplayable(
  steps: TutorialStep[],
  found: (step: TutorialStep) => boolean
): boolean {
  return steps.some(found);
}

/**
 * 掉过锚点解析不出来的步骤:从当前位置往后找第一个可显示的;都没有则关闭。
 * 已关闭的状态原样返回 —— 关闭后 resize/scroll 仍会重算,这条守卫是「关掉不再弹回来」的防线。
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

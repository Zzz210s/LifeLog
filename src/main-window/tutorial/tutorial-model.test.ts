import { describe, expect, it } from 'vitest';
import {
  isSeen, nextStep, exitTutorial, initialTutorial, dropMissing, hasDisplayable, TUTORIAL_STEPS,
} from './tutorial-model';

describe('tutorial-model', () => {
  it('无标记 -> 未看过;有 "1" -> 已看过;空串 -> 未看过', () => {
    expect(isSeen(null)).toBe(false);
    expect(isSeen('')).toBe(false);
    expect(isSeen('1')).toBe(true);
  });

  it('初始状态是第 0 步、打开', () => {
    expect(initialTutorial()).toEqual({ open: true, index: 0 });
  });

  it('推进到末步后下一步即关闭(不越界)', () => {
    let s = initialTutorial();
    for (let i = 0; i < TUTORIAL_STEPS.length - 1; i++) s = nextStep(s, TUTORIAL_STEPS);
    expect(s.index).toBe(TUTORIAL_STEPS.length - 1);
    expect(nextStep(s, TUTORIAL_STEPS)).toEqual({ open: false, index: s.index });
  });

  it('退出即关闭(跳过与走完同一条出口)', () => {
    expect(exitTutorial()).toEqual({ open: false, index: 0 });
  });

  it('一次只走一步(定点:1 -> 2)', () => {
    expect(nextStep({ open: true, index: 1 }, TUTORIAL_STEPS).index).toBe(2);
  });

  it('已关闭的状态:nextStep / dropMissing 都原样返回(关掉不再弹回来)', () => {
    const closed = { open: false, index: 0 };
    expect(nextStep(closed, TUTORIAL_STEPS)).toEqual(closed);
    expect(dropMissing(closed, TUTORIAL_STEPS, () => true)).toEqual(closed);
  });

  it('dropMissing 从**当前位置往后**找,不回退到已看过的步', () => {
    // 可显示的是下标 1 与 4;当前位置 2 -> 必须往后落到 4,而不是被倒回 1
    const later = (s: { id: string }) => s.id === TUTORIAL_STEPS[1].id || s.id === TUTORIAL_STEPS[4].id;
    expect(dropMissing({ open: true, index: 2 }, TUTORIAL_STEPS, later)).toEqual({ open: true, index: 4 });
    // 当前位置之后确实一个都不剩时才关闭(且 index 不回退)
    expect(dropMissing({ open: true, index: 2 }, TUTORIAL_STEPS, (s) => s.id === TUTORIAL_STEPS[1].id))
      .toEqual({ open: false, index: 2 });
  });

  it('hasDisplayable:区分「走完了」与「一步都显示不出来」', () => {
    expect(hasDisplayable(TUTORIAL_STEPS, () => false)).toBe(false);
    expect(hasDisplayable(TUTORIAL_STEPS, (s) => s.id === TUTORIAL_STEPS[3].id)).toBe(true);
  });

  it('锚点全缺的步骤被跳过;全缺时直接关闭', () => {
    const none = () => false;
    expect(dropMissing(initialTutorial(), TUTORIAL_STEPS, none)).toEqual({ open: false, index: 0 });
    const onlySecond = (s: { id: string }) => s.id === TUTORIAL_STEPS[1].id;
    expect(dropMissing(initialTutorial(), TUTORIAL_STEPS, onlySecond).index).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { isSeen, nextStep, exitTutorial, initialTutorial, dropMissing, TUTORIAL_STEPS } from './tutorial-model';

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

  it('锚点全缺的步骤被跳过;全缺时直接关闭', () => {
    const none = () => false;
    expect(dropMissing(initialTutorial(), TUTORIAL_STEPS, none)).toEqual({ open: false, index: 0 });
    const onlySecond = (s: { id: string }) => s.id === TUTORIAL_STEPS[1].id;
    expect(dropMissing(initialTutorial(), TUTORIAL_STEPS, onlySecond).index).toBe(1);
  });
});

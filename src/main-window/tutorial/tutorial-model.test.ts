import { describe, expect, it } from 'vitest';
import { isSeen, nextStep, exitTutorial, initialTutorial, dropMissing, TUTORIAL_STEPS } from './tutorial-model';

describe('tutorial-model', () => {
  it('4 步的锚点选择器是**字面快照**:改错选择器当场红(末步曾把菜单面板当锚点)', () => {
    expect(TUTORIAL_STEPS.map((s) => [s.id, s.selectors])).toEqual([
      ['input', ['[data-testid="unified-input"]']],
      ['prefix', ['[data-testid="prefix-hint"]']],
      ['tags', ['[data-testid="tag-list"]', '[data-testid="sidebar"]']],
      ['topbar', ['[aria-label="更多操作"]']], // 溢出菜单的**触发按钮**:面板只在展开时存在
    ]);
  });

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
    // 可显示的是下标 1 与 3;当前位置 2 -> 必须往后落到 3,而不是被倒回 1
    const later = (s: { id: string }) => s.id === TUTORIAL_STEPS[1].id || s.id === TUTORIAL_STEPS[3].id;
    expect(dropMissing({ open: true, index: 2 }, TUTORIAL_STEPS, later)).toEqual({ open: true, index: 3 });
    // 当前位置之后确实一个都不剩时才关闭(且 index 不回退)
    expect(dropMissing({ open: true, index: 2 }, TUTORIAL_STEPS, (s) => s.id === TUTORIAL_STEPS[1].id))
      .toEqual({ open: false, index: 2 });
  });

  it('锚点全缺的步骤被跳过;全缺时直接关闭', () => {
    const none = () => false;
    expect(dropMissing(initialTutorial(), TUTORIAL_STEPS, none)).toEqual({ open: false, index: 0 });
    const onlySecond = (s: { id: string }) => s.id === TUTORIAL_STEPS[1].id;
    expect(dropMissing(initialTutorial(), TUTORIAL_STEPS, onlySecond).index).toBe(1);
  });
});

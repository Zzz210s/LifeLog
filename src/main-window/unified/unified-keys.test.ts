/**
 * 统一输入框按键路由的用例(Task 6 补:零候选守卫;修复轮 1 补:输入法组合守卫)。
 * 重点是把「零候选时不得采纳」钉死 —— 调用方按索引取行,拿到 undefined 会静默无事发生。
 */
import { describe, expect, it } from 'vitest';
import { routeUnifiedKey } from './unified-keys';

const shown = { dropdownShown: true, activeIndex: 0, count: 0 };

describe('统一输入框按键路由(设计 §4)', () => {
  it('零候选:Tab 与 Enter 都不采纳(与 Enter 同守卫)', () => {
    expect(routeUnifiedKey({ key: 'Tab', ctrlKey: false }, shown)).toEqual({ type: 'ignore' });
    expect(routeUnifiedKey({ key: 'Enter', ctrlKey: false }, shown)).toEqual({ type: 'ignore' });
  });

  it('有候选:Tab 与 Enter 都采纳当前高亮行', () => {
    const ctx = { ...shown, activeIndex: 1, count: 3 };
    expect(routeUnifiedKey({ key: 'Tab', ctrlKey: false }, ctx)).toEqual({ type: 'accept', index: 1 });
    expect(routeUnifiedKey({ key: 'Enter', ctrlKey: false }, ctx)).toEqual({ type: 'accept', index: 1 });
  });

  it('Ctrl+Enter 恒为保存(下拉开着也一样)', () => {
    expect(routeUnifiedKey({ key: 'Enter', ctrlKey: true }, { ...shown, count: 2 })).toEqual({ type: 'save' });
  });

  it('输入法组合中一律未消费:Enter/Tab 不采纳、Ctrl+Enter 不保存、方向键不动高亮', () => {
    const ctx = { ...shown, count: 3 };
    const composing = { ctrlKey: false, isComposing: true };
    for (const k of ['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape']) {
      expect(routeUnifiedKey({ key: k, ...composing }, ctx)).toEqual({ type: 'ignore' });
    }
    expect(routeUnifiedKey({ key: 'Enter', ctrlKey: true, isComposing: true }, ctx)).toEqual({ type: 'ignore' });
  });

  it('keyCode 229(只给 keyCode 的输入法形态)与组合态等价', () => {
    const ctx = { ...shown, count: 3 };
    expect(routeUnifiedKey({ key: 'Enter', ctrlKey: false, keyCode: 229 }, ctx)).toEqual({ type: 'ignore' });
    expect(routeUnifiedKey({ key: 'Enter', ctrlKey: true, keyCode: 229 }, ctx)).toEqual({ type: 'ignore' });
  });

  it('Esc 恒交给状态机;没下拉时方向键放行给光标', () => {
    expect(routeUnifiedKey({ key: 'Escape', ctrlKey: false }, shown)).toEqual({ type: 'esc' });
    expect(routeUnifiedKey({ key: 'ArrowDown', ctrlKey: false }, { ...shown, dropdownShown: false, count: 2 }))
      .toEqual({ type: 'ignore' });
  });

  it('有候选时方向键按边界循环移动(上一位 = 末行)', () => {
    const ctx = { ...shown, activeIndex: 0, count: 3 };
    expect(routeUnifiedKey({ key: 'ArrowUp', ctrlKey: false }, ctx)).toEqual({ type: 'highlight', index: 2 });
    expect(routeUnifiedKey({ key: 'ArrowDown', ctrlKey: false }, ctx)).toEqual({ type: 'highlight', index: 1 });
  });
});

// @vitest-environment jsdom
/**
 * 标签搜索框的 Esc 只做一件事(盘点报告 2026-10-17 §5 点名的那处真双动作):
 * 「搜索框开着 + 预览卡片开着」时按一下 Esc,旧行为会同时清空搜索并关掉卡片。
 * 契约:搜索框自己处理完这一下就 `preventDefault` + `stopPropagation`,
 * 于是 `use-tag-click` 那条窗口级 Esc(只挡 `defaultPrevented`)收不到 —— 第二次 Esc 才关卡片。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mountClickFlow, type ClickFlow } from './__fixtures__/click-flow-harness';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let flow: ClickFlow | null = null;

beforeEach(() => {
  flow = null;
});

afterEach(() => {
  flow?.unmount();
});

const SEARCH_INPUT = '[aria-label="按名称收窄标签树"]';

const input = (h: ClickFlow): HTMLInputElement => {
  const el = h.host.querySelector(SEARCH_INPUT) as HTMLInputElement | null;
  if (el === null) throw new Error('搜索框没开');
  return el;
};

/** React 受控输入:走原生 setter + input 事件,和用户打字落到 onChange 的路径一致 */
const type = (el: HTMLInputElement, value: string): void => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** 在指定节点上按 Esc(冒泡到 window,与真实按键路径一致) */
const escOn = (node: HTMLElement): void => {
  act(() => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
};

describe('标签搜索框 Esc:先清搜索,不连带关预览卡片', () => {
  it('有字时第一次 Esc 只清搜索并收起框,卡片还在;第二次 Esc 才关卡片', () => {
    flow = mountClickFlow({ mode: 'open' });
    const h = flow;
    h.press('搜索');
    type(input(h), '书籍');
    expect(input(h).value).toBe('书籍');

    h.dblclickRow('书籍');
    expect(h.card()).not.toBeNull();

    escOn(input(h));
    expect(h.card(), '第一次 Esc 把预览卡片也关掉了(双动作)').not.toBeNull();
    expect(h.host.querySelector(SEARCH_INPUT)).toBeNull();

    escOn(document.body); // 框已收起:这一下走窗口级 Esc
    expect(h.card()).toBeNull();
  });

  it('搜索框空着时 Esc 照旧收起框,并且不关卡片(守卫不依赖有没有字)', () => {
    flow = mountClickFlow({ mode: 'open' });
    const h = flow;
    h.press('搜索');
    h.dblclickRow('书籍');
    expect(h.card()).not.toBeNull();

    escOn(input(h));
    expect(h.host.querySelector(SEARCH_INPUT)).toBeNull();
    expect(h.card()).not.toBeNull();
  });
});

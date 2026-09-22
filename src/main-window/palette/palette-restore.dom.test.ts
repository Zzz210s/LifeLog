/**
 * 焦点归位三档的单测(自 use-palette 抽出后的独立钉住;整体路径另见 palette-focus.dom.test.ts)。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { restoreFocus } from './palette-restore';

function el(id: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.id = id;
  document.body.appendChild(b);
  return b;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('palette-restore:归位顺序与"不抢"边界', () => {
  it('无接管者 + 打开前元素还在 -> 回到打开前元素', () => {
    const trigger = el('trigger');
    const input = el('input');
    input.focus();
    expect(restoreFocus({ restore: trigger, input, anchor: null })).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it('打开前元素已卸载 -> 退到主区锚点', () => {
    const trigger = el('trigger');
    const anchor = el('anchor');
    const input = el('input');
    trigger.remove();
    input.focus();
    expect(restoreFocus({ restore: trigger, input, anchor })).toBe(anchor);
    expect(document.activeElement).toBe(anchor);
  });

  it('锚点也没接入 -> 不调用 focus(不静默乱移焦点)', () => {
    const input = el('input');
    input.focus();
    expect(restoreFocus({ restore: null, input, anchor: null })).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('焦点已被别的元素接管 -> 不抢回', () => {
    const trigger = el('trigger');
    const other = el('other');
    const input = el('input');
    other.focus();
    expect(restoreFocus({ restore: trigger, input, anchor: null })).toBeNull();
    expect(document.activeElement).toBe(other);
  });

  it('焦点掉到 body(点过浮层非行区域)-> 视为无接管者,照常归位', () => {
    const trigger = el('trigger');
    const input = el('input');
    document.body.focus();
    expect(restoreFocus({ restore: trigger, input, anchor: null })).toBe(trigger);
  });
});

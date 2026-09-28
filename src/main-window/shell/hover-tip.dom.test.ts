// @vitest-environment jsdom
/**
 * 瞬时悬浮提示(HoverTip):原生 title 有约 1 秒延迟,用户要求"悬停即显示备注"。
 * 钉住:mouseover 立刻出气泡、mouseout 立刻收、空 data-tip 不弹、非 data-tip 元素不弹。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HoverTip } from './HoverTip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(HoverTip));
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

/** 造一个带 data-tip 的锚点元素并挂到 body(事件委托在 document 上) */
function anchor(tip: string | null): HTMLElement {
  const el = document.createElement('span');
  if (tip !== null) el.setAttribute('data-tip', tip);
  el.textContent = '郴';
  document.body.appendChild(el);
  return el;
}

const fire = (type: string, el: HTMLElement): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  });

const tip = (): HTMLElement | null => document.querySelector('[data-testid="hover-tip"]');

describe('HoverTip:悬停即显示,离开即收起', () => {
  it('mouseover 立刻出气泡,文本取自 data-tip', async () => {
    const el = anchor('chēn');
    await fire('mouseover', el);
    expect(tip()?.textContent).toBe('chēn');
  });

  it('mouseout 立刻收起', async () => {
    const el = anchor('chēn');
    await fire('mouseover', el);
    await fire('mouseout', el);
    expect(tip()).toBeNull();
  });

  it('空 data-tip 不弹(备注为空的字不该有气泡)', async () => {
    const el = anchor('');
    await fire('mouseover', el);
    expect(tip()).toBeNull();
  });

  it('没有 data-tip 的元素不弹(不误伤普通悬浮)', async () => {
    const el = anchor(null);
    await fire('mouseover', el);
    expect(tip()).toBeNull();
  });

  it('子元素冒泡上来也认(气泡挂在 span 内部的文本节点上也生效)', async () => {
    const el = anchor('chēn');
    const inner = document.createElement('b');
    el.appendChild(inner);
    await fire('mouseover', inner);
    expect(tip()?.textContent).toBe('chēn');
    await fire('mouseout', inner);
    expect(tip()).toBeNull();
  });
});

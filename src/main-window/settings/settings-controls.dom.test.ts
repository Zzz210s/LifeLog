// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NumberSlider } from './number-slider';
import { Segmented } from './segmented';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

const q = (sel: string): HTMLElement => {
  const el = host.querySelector(sel);
  if (!el) throw new Error('未找到 ' + sel);
  return el as HTMLElement;
};

/** React 的受控输入要用原生 setter 写值才会触发 onChange(直接改 .value 不经过 tracker) */
async function setValue(el: HTMLInputElement, value: string): Promise<void> {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    desc?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('NumberSlider(滑块 + 数字)', () => {
  function Host({ onCommit }: { onCommit: (n: number) => void }) {
    const [v, setV] = useState(4);
    return createElement(NumberSlider, {
      value: v, min: 0, max: 16, step: 1, label: '圆角', suffix: 'px',
      onCommit: (n) => { setV(n); onCommit(n); },
    });
  }

  it('滑块与数字框共用区间,拖滑块即提交', async () => {
    const onCommit = vi.fn();
    await act(async () => { root?.render(createElement(Host, { onCommit })); });
    const range = q('input[type="range"]') as HTMLInputElement;
    expect(range.min).toBe('0');
    expect(range.max).toBe('16');
    await setValue(range, '9');
    expect(onCommit).toHaveBeenCalledWith(9);
    expect((q('input[inputmode="numeric"]') as HTMLInputElement).value).toBe('9');
  });

  it('数字框失焦收敛到区间并提交', async () => {
    const onCommit = vi.fn();
    await act(async () => { root?.render(createElement(Host, { onCommit })); });
    const box = q('input[inputmode="numeric"]') as HTMLInputElement;
    await setValue(box, '99');
    await act(async () => { box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(onCommit).toHaveBeenCalledWith(16); // 夹到上限
  });

  it('非整数放弃编辑,回到原值', async () => {
    const onCommit = vi.fn();
    await act(async () => { root?.render(createElement(Host, { onCommit })); });
    const box = q('input[inputmode="numeric"]') as HTMLInputElement;
    await setValue(box, 'abc');
    await act(async () => { box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(onCommit).not.toHaveBeenCalled();
    expect(box.value).toBe('4');
  });
});

describe('Segmented(分段控件)', () => {
  const options = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '亮色' },
    { value: 'dark', label: '暗色' },
  ] as const;

  function Host({ onPick }: { onPick: (v: string) => void }) {
    const [v, setV] = useState<string>('light');
    return createElement(Segmented<string>, {
      value: v, options, label: '主题',
      onChange: (n) => { setV(n); onPick(n); },
    });
  }

  it('只有当前项 aria-pressed=true', async () => {
    await act(async () => { root?.render(createElement(Host, { onPick: () => {} })); });
    const pressed = [...host.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true', 'false']);
  });

  it('点另一项即切换', async () => {
    const onPick = vi.fn();
    await act(async () => { root?.render(createElement(Host, { onPick })); });
    await act(async () => { (host.querySelectorAll('button')[2] as HTMLButtonElement).click(); });
    expect(onPick).toHaveBeenCalledWith('dark');
  });

  it('左右方向键可切换(键盘可达)', async () => {
    const onPick = vi.fn();
    await act(async () => { root?.render(createElement(Host, { onPick })); });
    await act(async () => {
      q('[role="group"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(onPick).toHaveBeenCalledWith('dark'); // 亮色 -> 暗色
  });
});

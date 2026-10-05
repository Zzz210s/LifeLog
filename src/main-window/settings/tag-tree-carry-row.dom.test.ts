// @vitest-environment jsdom
/**
 * 设置页「标签类型」分区里的「标签树里显示携带」一行(标签类型 spec §5;Task 5 欠账 1):
 * 开关受控于传入的 checked,点击回传反转值;文案与 aria-label 固定。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TagTreeCarryRow } from './TagTreeCarryRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let calls: boolean[];

beforeEach(() => {
  calls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (checked: boolean): Promise<void> => {
  await act(async () =>
    root.render(createElement(TagTreeCarryRow, { checked, onChange: (v: boolean) => calls.push(v) }))
  );
};

const toggle = (): HTMLButtonElement => host.querySelector('button') as HTMLButtonElement;

describe('设置页:标签树里显示携带', () => {
  it('默认关:aria-checked=false;点击回传 true', async () => {
    await render(false);
    expect(host.textContent).toContain('标签树里显示携带');
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    await act(async () => toggle().click());
    expect(calls).toEqual([true]);
  });

  it('开启态:aria-checked=true;点击回传 false', async () => {
    await render(true);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    await act(async () => toggle().click());
    expect(calls).toEqual([false]);
  });
});

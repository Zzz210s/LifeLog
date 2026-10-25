// @vitest-environment jsdom
/** 「快捷搜索栏行高」设置项的接线:设置页滑块 ↔ App 状态 ↔ 输入框高度。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppearanceSection, type AppearanceSectionProps } from './AppearanceSection';

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
});

const render = async (props: Record<string, unknown>): Promise<void> => {
  await act(async () => {
    root!.render(createElement(AppearanceSection, props as unknown as AppearanceSectionProps));
  });
};

const sliderOf = (): HTMLInputElement => host.querySelector('input[type="range"]') as HTMLInputElement;

describe('外观分区:快捷搜索栏行高', () => {
  it('默认 36:滑块值 36,hint 说明与 Edge 地址栏同一口径', async () => {
    await render({ mode: 'system', onChange: () => {}, searchRow: { height: 36, onChange: () => {}, onReset: () => {} } });
    expect(host.textContent).toContain('快捷搜索栏行高');
    expect(sliderOf().value).toBe('36');
    expect(host.textContent).toContain('Edge 地址栏');
  });

  it('滑到 44 回报 44(区间 28–56、步长 2)', async () => {
    const seen: number[] = [];
    await render({ mode: 'system', onChange: () => {}, searchRow: { height: 36, onChange: (n: number) => seen.push(n), onReset: () => {} } });
    const slider = sliderOf();
    expect(slider.min).toBe('28');
    expect(slider.max).toBe('56');
    expect(slider.step).toBe('2');
    // 受控 range:原生 setter 写值 + 派发 input(React 的 onChange 挂 input 上)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(slider, '44');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(seen).toContain(44);
  });

  it('恢复本分区默认:主题回跟随系统且行高回默认', async () => {
    const modes: string[] = [];
    let resets = 0;
    await render({
      mode: 'dark',
      onChange: (m: string) => modes.push(m),
      searchRow: { height: 52, onChange: () => {}, onReset: () => { resets += 1; } },
    });
    const btn = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('恢复本分区默认'))!;
    await act(async () => {
      btn.click();
    });
    expect(modes).toEqual(['system']);
    expect(resets).toBe(1);
  });
});

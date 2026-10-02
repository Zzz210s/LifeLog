// @vitest-environment jsdom
/**
 * 「输入栏 -> 外观」段落的组件证据:四个预设按钮与高亮、圆角/透明度滑块回调、
 * 底色色盘 13 格(12 色 + 透明)与取色回调、边框色无透明格、亮暗页签切的是哪一份颜色、
 * 透明度 <40 的提示、以及 appearance=null 时的加载态与重试。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_DEFAULTS, type InputAppearance } from '../../shared/input-appearance';
import { InputAppearanceSection, type InputAppearanceSectionProps } from './InputAppearanceSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

interface Spies {
  onUpdate: ReturnType<typeof vi.fn>;
  onApplyPreset: ReturnType<typeof vi.fn>;
  onReload: ReturnType<typeof vi.fn>;
}

const render = (appearance: InputAppearance | null, error = ''): Spies => {
  const onUpdate = vi.fn();
  const onApplyPreset = vi.fn();
  const onReload = vi.fn();
  const props: InputAppearanceSectionProps = { appearance, error, onUpdate, onApplyPreset, onReload };
  act(() => root.render(createElement(InputAppearanceSection, props)));
  return { onUpdate, onApplyPreset, onReload };
};

const button = (text: string): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const swatch = (label: string): HTMLButtonElement => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
const menu = (): HTMLElement | null => host.querySelector('[role="menu"]');
const cell = (aria: string): HTMLButtonElement => host.querySelector(`[role="menuitem"][aria-label="${aria}"]`) as HTMLButtonElement;

/** 原生 range 的 input 事件(React 的 onChange 挂在 input 上) */
const setRange = (el: HTMLInputElement, value: number): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('预设与阴影', () => {
  it('四个预设按钮,默认「贴纸」高亮,点「玻璃」回传 glass', () => {
    const spies = render(APPEARANCE_DEFAULTS);
    const presets = ['贴纸', '极简', '玻璃', '纯色'].map(button);
    expect(presets.every(Boolean)).toBe(true);
    expect(button('贴纸').getAttribute('aria-pressed')).toBe('true');
    expect(button('玻璃').getAttribute('aria-pressed')).toBe('false');
    act(() => button('玻璃').click());
    expect(spies.onApplyPreset).toHaveBeenCalledWith('glass');
  });

  it('预设为 custom 时四个按钮都不高亮', () => {
    render({ ...APPEARANCE_DEFAULTS, preset: 'custom' });
    for (const label of ['贴纸', '极简', '玻璃', '纯色']) {
      expect(button(label).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('阴影四档,点「强」回传 3', () => {
    const spies = render(APPEARANCE_DEFAULTS);
    expect(button('强').getAttribute('aria-pressed')).toBe('false');
    act(() => button('强').click());
    expect(spies.onUpdate).toHaveBeenCalledWith('shadow', 3);
  });
});

describe('滑块', () => {
  it('圆角滑块 set 6 派发 input -> onUpdate(radius, 6)', () => {
    const spies = render(APPEARANCE_DEFAULTS);
    const slider = host.querySelector('input[aria-label="圆角"]') as HTMLInputElement;
    expect(slider.getAttribute('min')).toBe('0');
    expect(slider.getAttribute('max')).toBe('16');
    setRange(slider, 6);
    expect(spies.onUpdate).toHaveBeenCalledWith('radius', 6);
  });

  it('透明度滑块 set 30 -> onUpdate(opacity, 30)', () => {
    const spies = render(APPEARANCE_DEFAULTS);
    setRange(host.querySelector('input[aria-label="透明度"]') as HTMLInputElement, 30);
    expect(spies.onUpdate).toHaveBeenCalledWith('opacity', 30);
  });

  it('透明度 30 时行内出现提示,100 时不出现', () => {
    render({ ...APPEARANCE_DEFAULTS, opacity: 30 });
    expect(host.textContent).toContain('背景过透可能看不清输入内容');
    render({ ...APPEARANCE_DEFAULTS, opacity: 100 });
    expect(host.textContent).not.toContain('背景过透可能看不清输入内容');
  });
});

describe('色盘', () => {
  it('点底色色块出现 role=menu,13 格齐,点 #2563eb -> onUpdate(bg, ...)', () => {
    const spies = render(APPEARANCE_DEFAULTS);
    expect(menu()).toBeNull();
    act(() => swatch('底色').click());
    expect(menu()).not.toBeNull();
    expect([...host.querySelectorAll('[role="menuitem"]')]).toHaveLength(13);
    expect(cell('透明')).toBeTruthy();
    act(() => cell('颜色 #2563eb').click());
    expect(spies.onUpdate).toHaveBeenCalledWith('bg', '#2563eb');
    expect(menu()).toBeNull();
  });

  it('底色选透明格回传 transparent', () => {
    const spies = render(APPEARANCE_DEFAULTS);
    act(() => swatch('底色').click());
    act(() => cell('透明').click());
    expect(spies.onUpdate).toHaveBeenCalledWith('bg', 'transparent');
  });

  it('边框色没有透明格,点自定义颜色回传取色器值', () => {
    const spies = render(APPEARANCE_DEFAULTS);
    act(() => swatch('边框色').click());
    expect([...host.querySelectorAll('[role="menuitem"]')]).toHaveLength(12);
    expect(cell('透明')).toBeNull();
    const color = host.querySelector('input[aria-label="自定义颜色"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(color, '#123456');
      color.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(spies.onUpdate).toHaveBeenCalledWith('border', '#123456');
  });

  it('点暗色页签后再取色,改的是 bgDark 而不是 bg', () => {
    const spies = render(APPEARANCE_DEFAULTS);
    expect(button('亮色').getAttribute('aria-pressed')).toBe('true');
    act(() => button('暗色').click());
    expect(button('暗色').getAttribute('aria-pressed')).toBe('true');
    act(() => swatch('底色').click());
    act(() => cell('颜色 #ef4444').click());
    expect(spies.onUpdate).toHaveBeenCalledWith('bgDark', '#ef4444');
  });
});

describe('加载态', () => {
  it('appearance=null 且报错时显示加载态与重试按钮,点重试回调 onReload', () => {
    const spies = render(null, '读取外观设置失败: 网络错误');
    expect(host.textContent).toContain('加载中...');
    act(() => button('重试').click());
    expect(spies.onReload).toHaveBeenCalledTimes(1);
  });
});

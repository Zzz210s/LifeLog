// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UnifiedInput } from './UnifiedInput';
import type { PaletteController } from '../palette/use-palette';
import type { ListRow } from '../../shared/quickpick/model';

// 仓库既有 dom 测试约定:显式声明 act 环境,避免 React 的 stderr 噪声
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 参数名带下划线:mock 自身不用它,但类型要能接受被调用时传的内容
const saveInputNote = vi.fn(async (_s: string) => 1);
vi.mock('../../shared/api', () => ({ api: { saveInputNote: (s: string) => saveInputNote(s) } }));

let root: Root | null = null;
const mount = async (props: Partial<Parameters<typeof UnifiedInput>[0]> = {}) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(UnifiedInput, { onSaved: () => {}, editing: false, ...props })));
  return host;
};
const box = (host: HTMLElement) => host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
const type = async (host: HTMLElement, text: string) => {
  const el = box(host);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const key = async (host: HTMLElement, k: string, mod: KeyboardEventInit = {}) => {
  await act(async () => {
    box(host).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...mod }));
  });
};

const rows = (n: number): ListRow[] => // 候选行:列表模型的形状(buildList 的输出)
  Array.from({ length: n }, (_, i) => ({
    item: { id: `t${i}`, label: `标签${i}` },
    score: 1,
    ranges: [],
    positions: [],
    pinned: false,
    mruCount: 0,
  }));

const stubPalette = (over: Partial<PaletteController> = {}): PaletteController => ({ // 浮层控制器的桩
  isOpen: false, prefix: '', query: '', rows: [], total: 0, truncated: false, activeIndex: 0,
  inputRef: { current: null }, open: () => {}, close: () => {}, setQuery: () => {}, setPrefix: () => {},
  setActiveIndex: () => {}, accept: () => {}, handleKeyDown: () => {}, ...over,
});

beforeEach(() => saveInputNote.mockClear());
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('唯一输入框(设计 §3/§4)', () => {
  it('渲染成 textarea 且带 aria-label 与 data-testid', async () => {
    const host = await mount();
    expect(box(host).tagName).toBe('TEXTAREA');
    expect(box(host).getAttribute('aria-label')).toBe('统一输入框');
  });

  it('形态:保存按钮与输入框同一行(设计 §3 两行图)', async () => {
    const host = await mount();
    const btn = host.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toBe('保存');
    expect(btn.parentElement).toBe(box(host).parentElement);
  });

  it('记录模式 Ctrl+Enter 保存并清空', async () => {
    const host = await mount();
    await type(host, '买牛奶');
    await act(async () => {
      box(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    expect(saveInputNote).toHaveBeenCalledWith('买牛奶');
    expect(box(host).value).toBe('');
  });

  it('编辑态只读:不保存、提示行换成编辑说明', async () => {
    const host = await mount({ editing: true });
    expect(box(host).disabled).toBe(true);
    expect(host.textContent).toContain('编辑中');
    await act(async () => {
      box(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    expect(saveInputNote).not.toHaveBeenCalled();
  });

  it('记录模式不渲染下拉(设计 D6)', async () => {
    const host = await mount({ dropdown: createElement('div', { 'data-testid': 'fake-dropdown' }) });
    await type(host, '买牛奶');
    expect(host.querySelector('[data-testid="fake-dropdown"]')).toBeNull();
  });

  it('输入前缀时把模式上报给父组件', async () => {
    const seen: string[] = [];
    const host = await mount({ onStateChange: (s) => seen.push(s.mode) });
    await type(host, '#购');
    expect(seen.at(-1)).toBe('tag');
  });

  it('保存失败:内容保留并在框下给中文原因', async () => {
    saveInputNote.mockRejectedValueOnce(new Error('库锁住了'));
    const host = await mount();
    await type(host, '买牛奶');
    await act(async () => {
      box(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    expect(box(host).value).toBe('买牛奶');
    expect(host.textContent).toContain('保存失败');
  });

  it('保存失败后再输入即收起错误提示(否则它长期占着提示行)', async () => {
    saveInputNote.mockRejectedValueOnce(new Error('库锁住了'));
    const host = await mount();
    await type(host, '买牛奶');
    await key(host, 'Enter', { ctrlKey: true });
    expect(host.textContent).toContain('保存失败');
    await type(host, '买牛奶2');
    expect(host.textContent).not.toContain('保存失败');
  });
});

describe('唯一输入框的候选下拉(任务 5:复用浮层列表)', () => {
  const wire = (palette: PaletteController, onAccept?: (i: number) => void) =>
    ({ candidates: { palette }, onAccept });
  const drop = (host: HTMLElement) => host.querySelector('[data-testid="unified-dropdown"]');

  it('有前缀模式:下拉真的渲染(行来自列表模型)', async () => {
    const host = await mount(wire(stubPalette({ rows: rows(2), total: 2 })));
    await type(host, '#购');
    expect(drop(host)).not.toBeNull();
    expect(drop(host)!.querySelectorAll('li[role="option"]').length).toBe(2);
  });

  it('筛选模式不下拉(它是实时筛选,候选另行接;设计 §4)', async () => {
    const host = await mount(wire(stubPalette({ rows: rows(2), total: 2 })));
    await type(host, '/牛奶');
    expect(drop(host)).toBeNull();
  });

  it('浮层开着时让位给浮层(两种候选 UI 不同时出现)', async () => {
    const host = await mount(wire(stubPalette({ rows: rows(2), total: 2, isOpen: true })));
    await type(host, '#购');
    expect(drop(host)).toBeNull();
  });

  it('↓/↑ 走高亮(循环取模):首行上一位 = 末行', async () => {
    const setActiveIndex = vi.fn();
    const host = await mount(wire(stubPalette({ rows: rows(3), total: 3, activeIndex: 0, setActiveIndex })));
    await type(host, '#购');
    await key(host, 'ArrowUp');
    expect(setActiveIndex).toHaveBeenCalledWith(2);
    await key(host, 'ArrowDown');
    expect(setActiveIndex).toHaveBeenLastCalledWith(1); // 桩的 activeIndex 不变,故 0 + 1
  });

  it('Tab 与 Enter 采纳:交给 onAccept 并只关下拉(模式与内容保留)', async () => {
    const onAccept = vi.fn();
    const host = await mount(wire(stubPalette({ rows: rows(2), total: 2, activeIndex: 1 }), onAccept));
    await type(host, '#购');
    await key(host, 'Enter');
    expect(onAccept).toHaveBeenCalledWith(1);
    expect(drop(host)).toBeNull();
    expect(box(host).value).toBe('#购'); // 采纳保留模式:还能接着筛

    await key(host, 'Tab'); // 下拉已关 -> 候选键放行,不再采纳
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('记录模式没有下拉时按键全部放行(不误采纳)', async () => {
    const onAccept = vi.fn();
    const host = await mount(wire(stubPalette({ rows: rows(2), total: 2 }), onAccept));
    await type(host, '买牛奶');
    await key(host, 'Enter');
    await key(host, 'Tab');
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter 下拉开着也永远保存', async () => {
    const host = await mount(wire(stubPalette({ rows: rows(2), total: 2 })));
    await type(host, '#购');
    await key(host, 'Enter', { ctrlKey: true });
    expect(saveInputNote).toHaveBeenCalledWith('#购');
  });

  it('Esc 两级:先关下拉保留模式与内容,再按回记录模式', async () => {
    const host = await mount(wire(stubPalette({ rows: rows(2), total: 2 })));
    await type(host, '#购');
    await key(host, 'Escape');
    expect(drop(host)).toBeNull();
    expect(box(host).value).toBe('#购');
    await key(host, 'Escape');
    expect(box(host).value).toBe('');
  });
});

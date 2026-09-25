// @vitest-environment jsdom
/**
 * 统一输入框的 aria(设计 2026-09-24「通用规则 2」):combobox / aria-activedescendant /
 * 计数播报 / 提示行当前模式段,断言真实 DOM 上的角色与状态,不是组件内部字段。
 * 旧浮层的 aria 用例文件随浮层删除,这份接管其读数口径。
 * 另含「点提示行前缀段后焦点回到输入框」的接线用例(必修 2)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UnifiedInput } from './UnifiedInput';
import { MAX_RENDER_ROWS, clampActiveIndex } from '../palette/palette-limits';
import type { PaletteController } from '../palette/use-palette';
import type { ListRow } from '../../shared/quickpick/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../shared/api', () => ({ api: { saveInputNote: async (_s: string) => 1 } }));

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

const rows = (n: number): ListRow[] =>
  Array.from({ length: n }, (_, i) => ({
    item: { id: `t${i}`, label: `标签${i}` },
    score: 1, ranges: [], positions: [], pinned: false, mruCount: 0,
  }));

const stubPalette = (over: Partial<PaletteController> = {}): PaletteController => ({
  prefix: '', query: '', rows: [], total: 0, truncated: false, activeIndex: 0,
  setQuery: () => {}, setPrefix: () => {}, setActiveIndex: () => {}, ...over,
});

const view = (palette: PaletteController) =>
  createElement(UnifiedInput, { onSaved: () => {}, editing: false, candidates: { palette } });

const mount = async (palette: PaletteController): Promise<HTMLElement> => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(view(palette)));
  return host;
};
/** 换一份候选接线重渲染(输入框状态在同实例上保留) */
const rerender = async (palette: PaletteController): Promise<void> => {
  await act(async () => root!.render(view(palette)));
};

const box = (host: HTMLElement) => host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
const live = (host: HTMLElement) => host.querySelector('[aria-live="polite"]')?.textContent ?? null;
/** 输入框当前指向的候选行 id(没有属性时 null) */
const activeDescendant = (host: HTMLElement) =>
  host.querySelector('[aria-activedescendant]')?.getAttribute('aria-activedescendant') ?? null;

/**
 * 有状态候选宿主:高亮口径与真控制器相同(`clampActiveIndex`),只是候选直接喂进去,
 * 用来在 DOM 上观测键盘把高亮推到哪一行。
 */
function ClampedHost({ rowCount }: { rowCount: number }): ReactNode {
  const [rawActive, setRawActive] = useState(0);
  const palette: PaletteController = {
    prefix: '', query: '', rows: rows(rowCount), total: rowCount, truncated: false,
    activeIndex: clampActiveIndex(rawActive, rowCount),
    setQuery: () => {}, setPrefix: () => {}, setActiveIndex: setRawActive,
  };
  return createElement(UnifiedInput, { onSaved: () => {}, editing: false, candidates: { palette } });
}

const mountClamped = async (rowCount: number): Promise<HTMLElement> => {
  const el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root!.render(createElement(ClampedHost, { rowCount })));
  return el;
};

const type = async (host: HTMLElement, text: string) => {
  const el = box(host);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const key = async (host: HTMLElement, k: string) => {
  await act(async () => box(host).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
};
const click = async (host: HTMLElement, selector: string) => {
  await act(async () => (host.querySelector(selector) as HTMLElement).click());
};

describe('统一输入框 aria', () => {
  it('输入域是 combobox:expanded/controls/activedescendant 随下拉显隐变化,引用不悬空', async () => {
    const host = await mount(stubPalette({ rows: rows(2), total: 2, activeIndex: 1 }));
    const el = box(host);
    expect(el.getAttribute('role')).toBe('combobox');
    expect(el.getAttribute('aria-autocomplete')).toBe('list');
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.hasAttribute('aria-controls')).toBe(false);
    expect(el.hasAttribute('aria-activedescendant')).toBe(false);

    await type(host, '#购');
    const list = host.querySelector('[role="listbox"]');
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(el.getAttribute('aria-controls')).toBe(list?.getAttribute('id'));
    expect(el.getAttribute('aria-activedescendant')).toBe('unified-opt-1');
    expect(host.querySelector('#unified-opt-1')).not.toBeNull(); // 指向的行真的在

    await key(host, 'Escape');
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('候选超过渲染上限:范围外的高亮不输出 aria-activedescendant,也不留悬空引用', async () => {
    // 空 query 的 `@` 按一下 ↑ 就是 activeIndex = count-1(199):下拉只渲染前 90 行,id 只到 unified-opt-89
    const host = await mount(stubPalette({ rows: rows(200), total: 200, activeIndex: 199 }));
    await type(host, '@');
    const el = box(host);
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(el.hasAttribute('aria-activedescendant')).toBe(false); // 悬空 IDREF 比不输出更糟
    expect(host.querySelector('[aria-selected="true"]')).toBeNull(); // 高亮也一并钳在渲染范围内

    // 上限内仍照常输出,且指向的行真的在
    await rerender(stubPalette({ rows: rows(200), total: 200, activeIndex: 89 }));
    expect(el.getAttribute('aria-activedescendant')).toBe('unified-opt-89');
    expect(host.querySelector('#unified-opt-89')).not.toBeNull();
  });

  it('200 条候选时高亮夹在渲染范围内:键盘只在渲染窗口里取模', async () => {
    // 夹具的高亮口径与真控制器一致(clampActiveIndex);下拉只画 90 行
    const host = await mountClamped(200);
    await type(host, '@');
    expect(host.querySelectorAll('li[role="option"]').length).toBe(MAX_RENDER_ROWS);

    // ↑ 从首行循环到渲染窗口的最后一行:不是候选的第 199 行
    await key(host, 'ArrowUp');
    expect(activeDescendant(host)).toMatch(/^unified-opt-(?:[0-8]?\d)$/);
    expect(activeDescendant(host)).toBe(`unified-opt-${MAX_RENDER_ROWS - 1}`);
    expect(host.querySelector(`#unified-opt-${MAX_RENDER_ROWS - 1}`)).not.toBeNull();
    expect(host.querySelectorAll('[aria-selected="true"]').length).toBe(1);

    // ↓ 从末行回到首行(计数按渲染窗口 90 取模,不是按候选 200)
    await key(host, 'ArrowDown');
    expect(activeDescendant(host)).toBe('unified-opt-0');

    // 中段落点:再 ↓ 两次就是 2 —— 只断言两端的话,里面拄成另一套算法也看不出来
    await key(host, 'ArrowDown');
    await key(host, 'ArrowDown');
    expect(activeDescendant(host)).toBe('unified-opt-2');
  });

  it('空候选时不给 aria-activedescendant(空态不指一个不存在的行)', async () => {
    const host = await mount(stubPalette({ rows: [], total: 0 }));
    await type(host, '#购');
    expect(activeDescendant(host)).toBeNull();
  });

  it('listbox 里没有 role=list 的中间层,直接子元素是 presentation/option', async () => {
    const host = await mount(stubPalette({ rows: rows(3), total: 3 }));
    await type(host, '#购');
    const listbox = host.querySelector('[role="listbox"]') as HTMLElement;
    expect(listbox.querySelector('[role="list"]')).toBeNull();
    const roles = [...listbox.children].map((el) => el.getAttribute('role'));
    expect(roles.every((r) => r === 'presentation' || r === 'option' || r === 'group')).toBe(true);
    expect(listbox.querySelectorAll('li[role="option"]').length).toBe(3);
  });

  it('计数在 aria-live 里播报「N 个候选」并随候选数变化', async () => {
    const host = await mount(stubPalette({ rows: rows(3), total: 3 }));
    await type(host, '#购');
    expect(live(host)).toBe('3 个候选');
    await rerender(stubPalette({ rows: rows(1), total: 1 }));
    expect(live(host)).toBe('1 个候选');
    await rerender(stubPalette({ rows: [], total: 0 }));
    expect(live(host)).toBe('0 个候选');
  });

  it('提示行的当前模式段带 aria-current,其余段没有', async () => {
    const host = await mount(stubPalette({ rows: rows(1), total: 1 }));
    expect(host.querySelector('[data-prefix="#"]')?.getAttribute('aria-current')).toBeNull();
    await type(host, '#购');
    expect(host.querySelector('[data-prefix="#"]')?.getAttribute('aria-current')).toBe('true');
    expect(host.querySelector('[data-prefix="@"]')?.getAttribute('aria-current')).toBeNull();
  });
});

describe('提示行前缀段点击后焦点(必修 2)', () => {
  it('点 `#` 段:前缀写进输入框,且焦点回到输入框(不是留在按钮上)', async () => {
    const host = await mount(stubPalette());
    await click(host, '[data-prefix="#"]');
    expect(box(host).value).toBe('#');
    expect(document.activeElement).toBe(box(host));
  });
});

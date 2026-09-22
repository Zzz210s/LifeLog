// 浮层 aria 与空态(设计 §3.1/§3.8):断言真实 DOM 上的角色/状态,不是组件内部字段。
// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Palette } from './Palette';
import type { PaletteController } from './use-palette';
import { paletteHarness } from './palette-harness';
import type { PaletteHarness } from './palette-harness';

let ui: PaletteHarness;

beforeEach(() => {
  ui = paletteHarness();
});

afterEach(() => {
  ui.unmount();
});

function liveText(): string | undefined {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? undefined;
}

/** 只用于 SSR「首帧」读数的静态 controller(effect 在服务端不跑) */
function staticController(): PaletteController {
  return {
    isOpen: true, prefix: '', query: '', rows: [], total: 3, truncated: false, activeIndex: 0,
    inputRef: { current: null },
    open: () => {}, close: () => {}, setQuery: () => {}, setPrefix: () => {}, setActiveIndex: () => {},
    accept: () => {}, handleKeyDown: () => {},
  };
}

describe('浮层 aria', () => {
  it('输入框是 combobox,且 expanded/controls/activedescendant 自洽', () => {
    ui.open('>');
    const el = ui.input();
    expect(el.getAttribute('role')).toBe('combobox');
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(el.getAttribute('aria-autocomplete')).toBe('list');
    const list = document.querySelector('[role="listbox"]');
    expect(list).not.toBeNull();
    expect(el.getAttribute('aria-controls')).toBe(list?.id);
    expect(el.getAttribute('aria-label')).toBe('命令搜索');
    ui.press('ArrowDown');
    const option = document.querySelectorAll('[role="option"]')[1];
    expect(el.getAttribute('aria-activedescendant')).toBe(option.id);
  });

  it('listbox 每行都是 option,aria-selected 只落在焦点行,行不进 Tab 序列', () => {
    ui.open();
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.length).toBe(3);
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    ui.press('ArrowDown');
    const after = [...document.querySelectorAll('[role="option"]')];
    expect(after.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(options.every((o) => !o.hasAttribute('tabindex'))).toBe(true);
    expect(after[0].textContent).toBe('新建笔记');
  });

  it('计数在 aria-live 里播报「N 项」并随结果变化', () => {
    ui.open();
    expect(liveText()).toBe('3 项');
    ui.type('笔记');
    expect(liveText()).toBe('1 项');
    ui.type('zzz 无此命令');
    expect(liveText()).toBe('0 项');
  });

  it('关闭态保持挂载:aria-expanded 真为 false,根节点靠 hidden 隐藏(M1)', () => {
    const root = (): Element | null => document.querySelector('[data-floating="palette"]');
    expect(root()).not.toBeNull();
    expect(root()?.hasAttribute('hidden')).toBe(true);
    expect(ui.input().getAttribute('aria-expanded')).toBe('false');
    expect(liveText()).toBe('');
    ui.open();
    expect(root()?.hasAttribute('hidden')).toBe(false);
    expect(ui.input().getAttribute('aria-expanded')).toBe('true');
  });

  it('aria-live 区域先挂空,挂载后才写入计数(首帧不播报,M6)', () => {
    const html = renderToStaticMarkup(createElement(Palette, { controller: staticController() }));
    const firstFrame = new DOMParser().parseFromString(html, 'text/html');
    const live = firstFrame.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe(''); // 首帧区域已在、文本为空
    ui.open();
    expect(liveText()).toBe('3 项'); // 挂载后由 effect 写入
  });

  it('真实输入事件驱动查询(受控输入 -> onChange -> 列表重算)', () => {
    ui.open();
    ui.type('主题');
    expect(ui.controller().query).toBe('主题');
    expect(ui.controller().rows.map((r) => r.item.id)).toEqual(['theme.cycle']);
  });

  it('无结果时列表位置给一条不可执行的提示项', () => {
    ui.open();
    ui.type('zzz 无此命令');
    const hint = document.querySelector('[role="option"]');
    expect(hint?.getAttribute('aria-disabled')).toBe('true');
    expect(hint?.getAttribute('aria-selected')).toBe('false');
    expect(hint?.textContent).toContain('无匹配结果');
    expect(hint?.textContent).toContain('换个关键词,或用 > 执行命令');
    expect(ui.input().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('高亮段来自打分器的 positions(<mark> 数量 == 命中段数)', () => {
    ui.open();
    ui.type('设置');
    const marks = [...document.querySelectorAll('[role="option"] mark')];
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('设置');
  });

  it('行装饰:副文本 / danger / checked 由 decorations 决定(T6 按 provider 结果传入)', () => {
    ui.unmount();
    ui = paletteHarness({
      decorations: { 'theme.cycle': { detail: 'Ctrl+T', danger: true, checked: true } },
    });
    ui.open();
    const row = document.querySelector('[data-row-id="theme.cycle"]') as HTMLElement;
    expect(row.textContent).toContain('Ctrl+T');
    expect(row.textContent).toContain('已勾选');
    expect(row.className).toContain('text-danger');
  });

  it('根节点带 data-floating="palette"(供 T6 跳过「点区块外即保存」)', () => {
    ui.open();
    const root = document.querySelector('[data-floating="palette"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('role')).toBe('dialog');
    expect(root?.getAttribute('aria-label')).toBe('快速打开');
  });
});

/**
 * 前缀实时驱动(T6 brief:T5 只有 open(prefix),输入里的前缀要能当场切 provider)。
 * 用独立最小挂载层(不动 T5 的共用夹具):只关心 controller.prefix / query 与徽标文案。
 */
// @vitest-environment jsdom
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Palette, prefixLabel } from './Palette';
import { usePalette } from './use-palette';
import type { PaletteController } from './use-palette';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 与 host 接线同款:注册表里带前缀的 provider 命中即切前缀 */
const splitPrefix = (raw: string): { prefix: string; query: string } | null =>
  raw.startsWith('>') ? { prefix: '>', query: raw.slice(1) } : raw.startsWith('#') ? { prefix: '#', query: raw.slice(1) } : null;

interface Mounted {
  controller(): PaletteController;
  type(value: string): void;
  open(prefix?: string): void;
}

const hosts: Array<{ root: Root; host: HTMLDivElement }> = [];

function mount(useSplit: boolean): Mounted {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const box: { c: PaletteController | null } = { c: null };
  act(() =>
    root.render(
      createElement(function Host(): ReactNode {
        const c = usePalette({ items: [{ id: 'x', label: '甲' }], splitPrefix: useSplit ? splitPrefix : undefined });
        box.c = c;
        return createElement(Palette, { controller: c });
      }),
    ),
  );
  hosts.push({ root, host });
  const controller = (): PaletteController => box.c as PaletteController;
  const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  return {
    controller,
    open: (prefix = '') => act(() => controller().open(prefix)),
    type: (value) => {
      const el = input();
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      act(() => {
        setValue?.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  };
}

afterEach(() => {
  while (hosts.length > 0) {
    const { root, host } = hosts.pop()!;
    act(() => root.unmount());
    host.remove();
  }
  document.body.innerHTML = '';
});

describe('use-palette:前缀实时驱动', () => {
  it('注入 splitPrefix 后,输入里的 > / # 当场切前缀并剥掉前缀', () => {
    const h = mount(true);
    h.open('');
    expect(h.controller().prefix).toBe('');
    h.type('>导');
    expect(h.controller().prefix).toBe('>');
    expect(h.controller().query).toBe('导');
    h.type('#工');
    expect(h.controller().prefix).toBe('#');
    expect(h.controller().query).toBe('工');
    // 徽标跟着前缀走(命令 / 标签)
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('标签');
  });

  it('已在前缀里继续打字时保持该前缀(不带前缀的输入不切走)', () => {
    const h = mount(true);
    h.open('>');
    h.type('导');
    expect(h.controller().prefix).toBe('>');
    expect(h.controller().query).toBe('导');
  });

  it('不注入时保持 T5 行为:前缀由 open 决定,输入原样作为 query', () => {
    const h = mount(false);
    h.open('>');
    h.type('#工');
    expect(h.controller().prefix).toBe('>');
    expect(h.controller().query).toBe('#工');
  });

  it('prefixLabel 三档文案', () => {
    expect(prefixLabel('')).toBe('笔记');
    expect(prefixLabel('>')).toBe('命令');
    expect(prefixLabel('#')).toBe('标签');
  });
});

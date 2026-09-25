// @vitest-environment jsdom
/**
 * 候选控制器的夹紧口径(计划 3/3 Task 1):高亮**永远**落在渲染范围内。
 *
 * 下拉只画前 `MAX_RENDER_ROWS`(90)行,行 id 到 `unified-opt-89`;控制器若把高亮夹在
 * `rows.length - 1`,键盘/悬停就能把高亮推到 DOM 里不存在的行上(aria 引用悬空)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { QuickPickItem } from '../../shared/quickpick/model';
import { MAX_RENDER_ROWS } from './palette-limits';
import { usePalette, type PaletteController } from './use-palette';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = '';
});

const items = (n: number): QuickPickItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, label: `项${i}` }));

/** 挂一会话里的真 usePalette,只把候选注入;控制器对象每次渲染都是新的,故用 getter 取最新 */
function mount(count: number): { ctl: () => PaletteController } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  host = el;
  root = createRoot(el);
  let latest!: PaletteController;
  const Host = (): ReactNode => {
    latest = usePalette({ items: items(count) });
    return null;
  };
  act(() => root!.render(createElement(Host)));
  return { ctl: () => latest };
}

describe('候选控制器的 activeIndex 夹紧', () => {
  it('候选 200 条:高亮夹在渲染上限内(不是 rows.length - 1)', () => {
    const h = mount(200);
    expect(h.ctl().rows.length).toBe(200);
    act(() => h.ctl().setActiveIndex(199));
    expect(h.ctl().activeIndex).toBe(MAX_RENDER_ROWS - 1);
  });

  it('负数索引夹到 0;候选少于上限时仍夹到末行', () => {
    const h = mount(200);
    act(() => h.ctl().setActiveIndex(-5));
    expect(h.ctl().activeIndex).toBe(0);
    act(() => h.ctl().setActiveIndex(3));
    expect(h.ctl().activeIndex).toBe(3);
  });

  it('候选 3 条(少于渲染上限):夹到 2', () => {
    const h = mount(3);
    act(() => h.ctl().setActiveIndex(9));
    expect(h.ctl().activeIndex).toBe(2);
  });

  it('空列表:activeIndex 恒 0,不是 -1', () => {
    const h = mount(0);
    act(() => h.ctl().setActiveIndex(7));
    expect(h.ctl().activeIndex).toBe(0);
  });
});

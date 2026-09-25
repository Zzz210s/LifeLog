// @vitest-environment jsdom
/**
 * 条件栏(Task 2 瘦身):只留条件 chips + 中文摘要。
 * 排序 / 添加条件 / 导出的按钮全部搬走(排序与添加条件走 `>` 命令,鼠标入口是顶栏溢出菜单,Task 3);
 * chips 的显示、单删与语义色口径沿用旧 filter-bar-style.dom.test.ts 里仍然有效的回归项
 * (该文件同时断言「行内三个按钮」与「整条 40」,已在本次删除)。
 * 添加条件菜单改为受控:开关由命令 / Task 3 的顶栏菜单驾驶,浮层仍挂在本栏(锚点不变)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FilterConditions } from '../../shared/filter-conditions';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import { ConditionBar } from './ConditionBar';
import { summaryOf, summaryTitleOf } from './filter-chips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 六种 chip 各一个:关键词 / 标签 / 排除标签 / 有无标签 / 表达式 / 排序 */
const FULL: FilterConditions = {
  ...EMPTY_FILTER,
  keyword: '电影',
  tags: [{ path: '工作', includeChildren: true }],
  excludeTags: [{ path: '临时', includeChildren: false }],
  tagPresence: 'none',
  expr: '#工作 AND NOT #临时',
  sort: 'oldest',
};

let root: Root;
let host: HTMLDivElement;
let patches: Array<Partial<FilterConditions>>;
let opens: boolean[];

function render(conditions: FilterConditions = EMPTY_FILTER, addConditionOpen = false): void {
  act(() =>
    root.render(
      createElement(ConditionBar, {
        conditions,
        onPatch: (v: Partial<FilterConditions>) => patches.push(v),
        addConditionOpen,
        onAddConditionOpenChange: (open: boolean) => opens.push(open),
      })
    )
  );
}

const tokens = (el: Element): string[] => String(el.className).split(/\s+/).filter(Boolean);
const bar = (): HTMLElement => host.firstElementChild as HTMLElement;
const chips = (): HTMLElement[] =>
  [...host.querySelectorAll('[aria-label="已生效的筛选条件"] > span')] as HTMLElement[];
const menu = (): HTMLElement | null => host.querySelector('[role="menu"]');
const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll('button')] as HTMLButtonElement[];
/** 按钮的可见文本 + aria-label(搬走的三个入口按这两个维度判定,不只看纯文本) */
const buttonText = (b: HTMLButtonElement): string =>
  `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`;

beforeEach(() => {
  patches = [];
  opens = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('条件栏:只剩 chips 与摘要', () => {
  it('不渲染排序 / 导出 / 添加条件按钮(鼠标入口在顶栏溢出菜单)', () => {
    render(FULL);
    expect(buttons().length).toBeGreaterThan(0); // 断言不是"整栏没按钮"这种假绿
    for (const b of buttons()) {
      expect(buttonText(b)).not.toMatch(/排序|导出|添加条件/);
    }
    // 剩下的按钮只能是 chip 自己的单删 × 与表达式编辑入口
    for (const b of buttons()) {
      expect(buttonText(b)).toMatch(/移除条件|编辑条件/);
    }
  });

  it('外层仍是条件栏样式(border-b + px-4 + py-1),故以 data-testid 锚定', () => {
    render();
    const t = tokens(bar());
    for (const token of ['border-b', 'border-border', 'px-4', 'py-1']) expect(t).toContain(token);
    expect(bar().getAttribute('data-testid')).toBe('condition-bar');
  });
});

describe('条件栏:条件 chips 的显示与单删', () => {
  it('关键词 chip 可单删:点 × 回传 keyword: null,其余条件原样带出', () => {
    render(FULL);
    const removeBtn = chips()[0].querySelector('button') as HTMLButtonElement;
    expect(removeBtn.getAttribute('aria-label')).toBe('移除条件 关键词:电影');
    act(() => removeBtn.click());
    expect(patches.length).toBe(1);
    expect(patches[0].keyword).toBeNull();
    expect(patches[0].tags).toEqual(FULL.tags);
  });

  it('tags / excludeTags 各自一个 chip,标签文案即路径', () => {
    render(FULL);
    const labels = chips().map((c) => c.textContent ?? '');
    expect(chips().length).toBe(6);
    expect(labels[1]).toContain('工作');
    expect(labels[2]).toContain('临时');
    expect(patches).toEqual([]);
  });

  it('回归:六种 chip 都是 rounded-xs + text-label + 1px border,gap-1(4px)', () => {
    render(FULL);
    const list = chips();
    expect(tokens(list[0].parentElement as HTMLElement)).toContain('gap-1');
    for (const chip of list) {
      const t = tokens(chip);
      for (const token of ['rounded-xs', 'border', 'text-label', 'px-2', 'py-0.5']) expect(t).toContain(token);
      expect(t).not.toContain('rounded-full');
    }
  });

  it('回归:中性条件(有无标签 / 排序)= chrome 底 + muted 字;收窄条件 = accent', () => {
    render(FULL);
    const [keyword, tag, , presence, expr, sort] = chips();
    for (const neutral of [presence, sort]) {
      const t = tokens(neutral);
      expect(t).toContain('bg-chrome');
      expect(t).toContain('text-muted');
      expect(t).not.toContain('bg-accent-soft');
    }
    for (const picked of [keyword, tag, expr]) {
      const t = tokens(picked);
      expect(t).toContain('bg-accent-soft');
      expect(t).toContain('text-accent-text');
    }
  });

  it('回归:排除标签 chip 仍走 danger 语义色;表达式 chip 的 label 可点(编辑入口)', () => {
    render(FULL);
    const exclude = tokens(chips()[2]);
    expect(exclude).toContain('text-danger');
    expect(exclude).toContain('bg-danger-soft');
    expect(chips()[4].querySelector('button[aria-label^="编辑条件"]')).toBeTruthy();
    expect(chips()[0].querySelector('button[aria-label^="编辑条件"]')).toBeNull();
  });
});

describe('条件栏:中文摘要', () => {
  it('渲染中文摘要且带 title(悬浮看未截断的表达式原文)', () => {
    render(FULL);
    const summary = host.querySelector('[data-testid="condition-bar-summary"]') as HTMLElement;
    expect(summary.textContent).toBe(summaryOf(FULL));
    expect(summary.getAttribute('title')).toBe(summaryTitleOf(FULL));
    expect(tokens(summary)).toContain('text-label');
    expect(tokens(summary)).toContain('text-muted');
  });

  it('空条件不渲染摘要', () => {
    render();
    expect(host.querySelector('[data-testid="condition-bar-summary"]')).toBeNull();
  });
});

describe('条件栏:添加条件菜单受控', () => {
  it('addConditionOpen=true 时菜单出现,五项在;false 时不渲染菜单', () => {
    const items = (): string[] =>
      [...(menu() as HTMLElement).querySelectorAll('button[role="menuitem"]')].map((b) => b.textContent ?? '');
    render(FULL);
    expect(menu()).toBeNull();
    render(FULL, true);
    expect(menu()).not.toBeNull();
    expect(items()).toEqual(['标签', '排除标签', '有无标签', '排序', '表达式(高级)']);
  });

  it('有无标签子面板:文案是「无标签」,不再叫「无自定义标签」', () => {
    const items = (): string[] =>
      [...(menu() as HTMLElement).querySelectorAll('button[role="menuitem"]')].map((b) => b.textContent ?? '');
    render(FULL, true);
    const pane = [...(menu() as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (b) => b.textContent === '有无标签'
    ) as HTMLButtonElement;
    act(() => pane.click());
    expect(items()).toEqual(['不限', '有标签', '无标签']);
  });

  it('菜单自身只通过 onAddConditionOpenChange 关闭(受控,不自持状态)', () => {
    render(FULL, true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(opens).toEqual([false]);
    expect(menu()).not.toBeNull(); // 父级还没把 open 置假,浮层就还在
  });
});

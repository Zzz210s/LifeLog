// @vitest-environment jsdom
/**
 * 视觉刷新 V3「筛选栏 + 条件 chips」的组件证据(jsdom,只看类名,不引入计算样式):
 * 输入框与按钮统一 h-8(32)/rounded-sm(6px)/text-ui;整条 py-1(32+8 = 40);行 gap-2(8px);
 * 条件 chips 沿用 chip 中性化口径(rounded-xs + text-label);排序/有无标签这类中性条件走 chrome 底,
 * 已生效的收窄条件(关键词/标签/表达式)才用 accent,排除仍走 danger;单删行为不变(回归)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FilterConditions } from '../../shared/filter-conditions';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import { FilterBar } from './FilterBar';

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

async function render(conditions: FilterConditions = EMPTY_FILTER): Promise<void> {
  await act(async () => {
    root.render(
      createElement(FilterBar, {
        conditions,
        onPatch: (v: Partial<FilterConditions>) => patches.push(v),
        onExport: () => {},
      })
    );
  });
}

const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);
const input = (): HTMLElement => host.querySelector('input[aria-label="搜索笔记与标签"]') as HTMLElement;
const row = (): HTMLElement => input().parentElement as HTMLElement;
const chips = (): HTMLElement[] =>
  [...host.querySelectorAll('[aria-label="已生效的筛选条件"] > span')] as HTMLElement[];

beforeEach(() => {
  patches = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('V3 筛选栏:控件统一 32 / r6 / text-ui,整条 40', () => {
  it('整条 py-1(32 + 8 = 40),行间距 gap-2(8px)', async () => {
    await render();
    const bar = row().parentElement as HTMLElement;
    for (const token of ['px-4', 'py-1', 'border-b', 'border-border']) expect(tokens(bar)).toContain(token);
    expect(tokens(row())).toContain('gap-2');
  });

  it('输入框 h-8 / rounded-sm / text-ui(不再 rounded-md / text-sm)', async () => {
    await render();
    const t = tokens(input());
    for (const token of ['h-8', 'rounded-sm', 'text-ui', 'border']) expect(t).toContain(token);
    expect(t).not.toContain('rounded-md');
    expect(t).not.toContain('text-sm');
  });

  it('行内每个按钮都 h-8 / rounded-sm / text-ui(排序、添加条件、导出全部)', async () => {
    await render();
    const buttons = [...row().querySelectorAll('button')] as HTMLElement[];
    expect(buttons.length).toBe(3);
    for (const b of buttons) {
      for (const token of ['h-8', 'rounded-sm', 'text-ui']) expect(tokens(b)).toContain(token);
      expect(tokens(b)).not.toContain('rounded-md');
    }
  });

  it('摘要行用 text-label(不再 text-xs),空条件时不出 chips 区', async () => {
    await render();
    expect(chips().length).toBe(0);
    await render(FULL);
    const summary = host.querySelector('p') as HTMLElement;
    expect(tokens(summary)).toContain('text-label');
  });
});

describe('V3 条件 chips:中性化口径 + 语义色分工', () => {
  it('六种 chip 都是 rounded-xs + text-label + 1px border,gap-1(4px)', async () => {
    await render(FULL);
    const list = chips();
    expect(list.length).toBe(6);
    expect(tokens(list[0].parentElement as HTMLElement)).toContain('gap-1');
    for (const chip of list) {
      const t = tokens(chip);
      for (const token of ['rounded-xs', 'border', 'text-label', 'px-2', 'py-0.5']) expect(t).toContain(token);
      expect(t).not.toContain('rounded-full');
    }
  });

  it('中性条件(有无标签 / 排序)= chrome 底 + muted 字;收窄条件(关键词/标签/表达式)= accent', async () => {
    await render(FULL);
    const [keyword, tag, , presence, expr, sort] = chips();
    for (const neutral of [presence, sort]) {
      const t = tokens(neutral);
      expect(t).toContain('bg-chrome');
      expect(t).toContain('text-muted');
      expect(t).not.toContain('bg-accent-soft');
      expect(t).not.toContain('text-accent-text');
    }
    for (const picked of [keyword, tag, expr]) {
      const t = tokens(picked);
      expect(t).toContain('bg-accent-soft');
      expect(t).toContain('text-accent-text');
    }
  });

  it('排除标签 chip 仍走 danger 语义色(不是 accent)', async () => {
    await render(FULL);
    const exclude = chips()[2];
    const t = tokens(exclude);
    expect(t).toContain('text-danger');
    expect(t).toContain('bg-danger-soft');
    expect(t).not.toContain('text-accent-text');
  });

  it('回归:点 × 仍回传"删掉该条件后的完整条件对象"', async () => {
    await render(FULL);
    const removeBtn = chips()[0].querySelector('button') as HTMLButtonElement;
    expect(removeBtn.getAttribute('aria-label')).toBe('移除条件 关键词:电影');
    await act(async () => removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(patches.length).toBe(1);
    expect(patches[0].keyword).toBeNull();
    // 其余条件原样带出(整体替换语义)
    expect(patches[0].tags).toEqual(FULL.tags);
  });

  it('回归:表达式 chip 的 label 可点(编辑入口),非表达式 chip 的 label 不是按钮', async () => {
    await render(FULL);
    expect(chips()[4].querySelector('button[aria-label^="编辑条件"]')).toBeTruthy();
    expect(chips()[0].querySelector('button[aria-label^="编辑条件"]')).toBeNull();
  });
});

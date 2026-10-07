// @vitest-environment jsdom
/**
 * 分组面板(设计 §6 / 计划 T5):选轴(标签选择器)+ 方向 + 清除;
 * 只写 `conditions.groupBy`,**不清筛选、不影响命中数**(与排序同口径)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { GroupByPanel } from './GroupByPanel';

vi.mock('../../shared/api', () => ({
  api: {
    listTags: () =>
      Promise.resolve([
        { id: 1, path: '地点', depth: 1, self_count: 0, subtree_count: 779 },
        { id: 2, path: '地点/美国', depth: 2, self_count: 169, subtree_count: 169 },
      ]),
  },
}));

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

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const render = (conditions: FilterConditions, onPatch: (v: Partial<FilterConditions>) => void): void =>
  act(() => root.render(createElement(GroupByPanel, { conditions, onPatch })));
const byTestId = (id: string): HTMLElement =>
  host.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const tokens = (el: Element): string[] => String(el.className).split(/\s+/).filter(Boolean);

describe('分组面板:选轴与清除', () => {
  it('默认显示「不分组」;点「+ 分组轴」开标签选择器,选中回传 path + 默认方向 asc', async () => {
    const onPatch = vi.fn();
    render(EMPTY_FILTER, onPatch);
    expect(byTestId('group-panel').textContent).toContain('默认:不分组');

    act(() => byTestId('group-add').click());
    await flush();
    const dlg = host.querySelector('[role="dialog"][aria-label="添加标签"]') as HTMLElement;
    expect(dlg).not.toBeNull();
    const row = dlg.querySelector('ul button') as HTMLElement;
    act(() => row.click());
    expect(onPatch).toHaveBeenCalledWith({ groupBy: { path: '地点', dir: 'asc' } });
  });

  it('已有分组:显示末段名;改方向回传 desc;清除回传 null', () => {
    const onPatch = vi.fn();
    render({ ...EMPTY_FILTER, groupBy: { path: '地点/美国', dir: 'asc' } }, onPatch);
    expect(byTestId('group-panel').textContent).toContain('美国');

    const sel = host.querySelector('select[aria-label="组间方向"]') as HTMLSelectElement;
    act(() => {
      sel.value = 'desc';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onPatch).toHaveBeenCalledWith({ groupBy: { path: '地点/美国', dir: 'desc' } });

    const clear = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('清除'));
    act(() => (clear as HTMLElement).click());
    expect(onPatch).toHaveBeenCalledWith({ groupBy: null });
  });

  it('换轴保留已选方向(方向是用户对「组间怎么排」的意图,与具体轴无关)', async () => {
    const onPatch = vi.fn();
    render({ ...EMPTY_FILTER, groupBy: { path: '状态', dir: 'desc' } }, onPatch);
    act(() => byTestId('group-add').click());
    await flush();
    const row = (host.querySelector('[role="dialog"] ul button') as HTMLElement);
    act(() => row.click());
    expect(onPatch).toHaveBeenCalledWith({ groupBy: { path: '地点', dir: 'desc' } });
  });
});

describe('分组面板:V5 视觉令牌档位(登记进源码门禁)', () => {
  it('按钮/选择器 = rounded-xs + text-label(不回到 text-xs / rounded-md)', () => {
    render({ ...EMPTY_FILTER, groupBy: { path: '地点', dir: 'asc' } }, () => {});
    for (const btn of host.querySelectorAll('button')) {
      const t = tokens(btn);
      expect(t).toContain('rounded-xs');
      expect(t.some((x) => x === 'text-label' || x === 'text-ui')).toBe(true);
      for (const bad of ['text-xs', 'text-sm', 'rounded-md', 'h-6', 'h-9']) expect(t).not.toContain(bad);
    }
    const sel = host.querySelector('select') as HTMLElement;
    expect(tokens(sel)).toContain('h-7');
    expect(tokens(sel)).toContain('rounded-xs');
  });
});

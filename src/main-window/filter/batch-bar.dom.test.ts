// @vitest-environment jsdom
/**
 * 批量浮条的渲染与点击接线(spec 2026-10-17 §3/§5/§6):
 * 计数、两个全选按钮的态与文案、取消、删除(0 选禁用)、导出选中(回执走同一条通道)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchBar } from './BatchBar';
import type { BatchApi } from './use-batch-selection';

const { save, exportPointsOf, completeNotes, listTags } = vi.hoisted(() => ({
  save: vi.fn(async (_o: unknown): Promise<string | null> => 'C:/tmp/选中.xlsx'),
  exportPointsOf: vi.fn(async (_path: string, _ids: number[]) => {}),
  completeNotes: vi.fn(async () => []),
  listTags: vi.fn(async () => []),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save }));
vi.mock('../../shared/api', () => ({ api: { exportPointsOf, completeNotes, listTags } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

/** 只准备断言用到的那几项,其余给 no-op(浮条不读别的东西) */
function fake(over: Partial<BatchApi> = {}): BatchApi {
  return {
    on: true,
    selected: new Set([1, 2, 3]),
    notice: null,
    busy: false,
    pageAll: false,
    filterAll: false,
    filterTotal: null,
    toggleOn: vi.fn(),
    toggle: vi.fn(),
    selectPage: vi.fn(),
    selectAll: vi.fn(),
    cancel: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    removeSelected: vi.fn(),
    notify: vi.fn(),
    ...over,
  };
}

const mount = async (b: BatchApi): Promise<void> => {
  await act(async () => root.render(createElement(BatchBar, { batch: b, dataVersion: 0 })));
};

const btn = (id: string): HTMLButtonElement =>
  host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

const click = (el: Element): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe('批量浮条', () => {
  it('计数与两个全选按钮的文案来自选中态', async () => {
    const b = fake();
    await mount(b);
    expect(host.querySelector('[data-testid="batch-count"]')!.textContent).toBe('已选 3 条');
    expect(btn('batch-select-page').textContent).toBe('全选本页');
    expect(btn('batch-select-all').textContent).toBe('全选筛选结果');
  });

  it('已全选时按钮切到取消档', async () => {
    await mount(fake({ pageAll: true, filterAll: true, filterTotal: 3 }));
    expect(btn('batch-select-page').textContent).toBe('取消本页');
    expect(btn('batch-select-all').textContent).toBe('取消全选');
  });

  it('全选本页 / 全选筛选结果 / 取消各调一次对应动作', async () => {
    const b = fake();
    await mount(b);
    await click(btn('batch-select-page'));
    await click(btn('batch-select-all'));
    await click(btn('batch-cancel'));
    expect(b.selectPage).toHaveBeenCalledTimes(1);
    expect(b.selectAll).toHaveBeenCalledTimes(1);
    expect(b.cancel).toHaveBeenCalledTimes(1);
  });

  it('0 选时删除与导出禁用(不发 IPC)', async () => {
    const b = fake({ selected: new Set() });
    await mount(b);
    expect(btn('batch-delete').disabled).toBe(true);
    expect(btn('batch-export').disabled).toBe(true);
    await click(btn('batch-delete'));
    expect(b.removeSelected).not.toHaveBeenCalled();
  });

  it('删除按钮带头数与二次确认入口(动作交给 hook)', async () => {
    const b = fake();
    await mount(b);
    expect(btn('batch-delete').textContent).toContain('3');
    await click(btn('batch-delete'));
    expect(b.removeSelected).toHaveBeenCalledTimes(1);
  });

  it('导出选中:带上全部 id 调 IPC,并把回执交给同一条通道', async () => {
    const b = fake();
    await mount(b);
    await click(btn('batch-export'));
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(exportPointsOf).toHaveBeenCalledWith('C:/tmp/选中.xlsx', [1, 2, 3]);
    expect(b.notify).toHaveBeenCalledWith('已导出 3 条');
  });

  it('回执区渲染 hook 给的文案', async () => {
    await mount(fake({ notice: '已删除 2 条；快照：F:/x.db' }));
    expect(host.querySelector('[data-testid="batch-notice"]')!.textContent).toContain('快照：F:/x.db');
  });
});

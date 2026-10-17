// @vitest-environment jsdom
/**
 * 条件栏「编辑条件」入口(方案 A,spec 2026-10-17 §A1):开启后**条件项**左侧出勾选框、
 * 条件项的单删 × 让位给浮条的「删除选中」;排序 / 分组 chip 不是条件项,不参与、× 照旧。
 * 闸门与四个补丁由 `cond-batch.test.ts` 钉住,这里只看渲染与接线。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { FULL_BAR_COND } from './__fixtures__/condition-bar-harness';
import { condGate } from './cond-batch';
import { ConditionBar } from './ConditionBar';
import type { CondBatchApi } from './use-cond-batch';

const { carriedTagPaths, conditionHitCounts } = vi.hoisted(() => ({
  carriedTagPaths: vi.fn(),
  conditionHitCounts: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { carriedTagPaths, conditionHitCounts } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let toggled: string[] = [];

const fakeCondBatch = (on: boolean, selected: string[] = []): CondBatchApi => ({
  on,
  selected: new Set(selected),
  count: selected.length,
  allSelected: false,
  gate: condGate(EMPTY_FILTER, new Set()),
  toggleOn: vi.fn(),
  toggle: (k: string) => toggled.push(k),
  selectAll: vi.fn(),
  cancel: vi.fn(),
  removeSelected: vi.fn(),
  setChildren: vi.fn(),
  moveSide: vi.fn(),
  wrapNewGroup: vi.fn(),
});

const render = async (condBatch?: CondBatchApi, conditions: FilterConditions = FULL_BAR_COND) => {
  await act(async () => {
    root.render(
      createElement(ConditionBar, {
        conditions,
        onPatch: vi.fn(),
        addConditionOpen: false,
        onAddConditionOpenChange: vi.fn(),
        ...(condBatch !== undefined ? { condBatch } : {}),
      })
    );
  });
};

const checks = (): HTMLInputElement[] =>
  [...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
const checksByKey = (key: string): HTMLInputElement | null =>
  host.querySelector(`input[data-testid="cond-check-${key}"]`);
const chips = (): HTMLElement[] =>
  [...host.querySelectorAll('[aria-label="已生效的筛选条件"] > span')] as HTMLElement[];
const toggleBtn = (): HTMLButtonElement | null =>
  host.querySelector('button[data-testid="cond-batch-toggle"]');

beforeEach(() => {
  toggled = [];
  carriedTagPaths.mockReset();
  carriedTagPaths.mockResolvedValue([]);
  conditionHitCounts.mockReset();
  conditionHitCounts.mockResolvedValue({ groups: [{ op: 'and', itemHits: [1, 1, 1, 1, 1], groupHit: null }] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe('条件栏「编辑条件」入口', () => {
  it('开启后:5 个条件项各一个勾选框,排序 chip 没有(它不是条件项)', async () => {
    await render(fakeCondBatch(true));
    expect(chips().length).toBe(6);
    expect(checks().length).toBe(5);
    expect(checksByKey('0:0')).not.toBeNull();
    expect(checksByKey('0:4')).not.toBeNull();
    expect(checksByKey('1:0')).toBeNull();
    // 勾选框在 chip 的最左:第一个子元素就是它
    expect(checksByKey('0:1')!.parentElement!.firstElementChild).toBe(checksByKey('0:1'));
  });

  it('关闭 / 不传:零勾选框,既有 × 全在(既有渲染不变)', async () => {
    await render(fakeCondBatch(false));
    expect(checks().length).toBe(0);
    expect(chips()[0].querySelector('button')).not.toBeNull();
    await render();
    expect(checks().length).toBe(0);
    expect(toggleBtn()).toBeNull();
  });

  it('点勾选框回传条件项的位置键;选中态映射回 checked', async () => {
    await render(fakeCondBatch(true, ['0:2']));
    expect(checksByKey('0:2')!.checked).toBe(true);
    expect(checksByKey('0:1')!.checked).toBe(false);
    await act(async () => checksByKey('0:1')!.click());
    expect(toggled).toEqual(['0:1']);
  });

  it('批量态下条件项的单删 × 隐藏(删除走浮条),排序 chip 的 × 照旧', async () => {
    await render(fakeCondBatch(true));
    const sortChip = chips()[5];
    expect(sortChip.querySelector('button[aria-label^="移除条件"]')).not.toBeNull();
    for (const chip of chips().slice(0, 5)) {
      expect(chip.querySelector('button[aria-label^="移除条件"]')).toBeNull();
    }
  });

  it('开关按钮带 data-cond-batch 锚点,按下态随 on;点击调 toggleOn', async () => {
    const on = fakeCondBatch(true);
    await render(on);
    expect(toggleBtn()!.getAttribute('data-cond-batch')).toBe('on');
    expect(toggleBtn()!.getAttribute('aria-label')).toBe('编辑条件');
    await act(async () => toggleBtn()!.click());
    expect(on.toggleOn).toHaveBeenCalledTimes(1);
    await render(fakeCondBatch(false));
    expect(toggleBtn()!.getAttribute('data-cond-batch')).toBe('off');
  });
});

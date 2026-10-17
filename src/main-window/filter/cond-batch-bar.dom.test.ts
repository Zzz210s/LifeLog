// @vitest-environment jsdom
/**
 * 条件批量浮条(方案 A,spec 2026-10-17 §A1):读数与全选文案、四个动作各接一条线、
 * 非标签条件选中时四个动作整体禁用并给中文说明、取消退出。动作本身只验证「接到 hook」——
 * 补丁正确性由 `cond-batch.test.ts` 的纯函数用例钉住。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions, GroupItem } from '../../shared/filter-conditions';
import { condGate } from './cond-batch';
import { CondBatchBar } from './CondBatchBar';
import type { CondBatchApi } from './use-cond-batch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tag = (path: string): GroupItem => ({ kind: 'tag', path, includeChildren: true });
const exTag = (path: string): GroupItem => ({ kind: 'excludeTag', path, includeChildren: false });
const kw = (value: string): GroupItem => ({ kind: 'keyword', value });

const cond = (...items: GroupItem[]): FilterConditions => ({
  ...EMPTY_FILTER,
  groups: [{ op: 'and', items }],
});

/** 只准备断言用到的字段,gate 用真实现从 (conditions, selected) 派生 */
function fake(over: Partial<CondBatchApi> = {}, conditions: FilterConditions = cond(tag('工作'))): CondBatchApi {
  const base = {
    on: true,
    selected: new Set(['0:0']) as ReadonlySet<string>,
    count: 1,
    allSelected: false,
    toggleOn: vi.fn(),
    toggle: vi.fn(),
    selectAll: vi.fn(),
    cancel: vi.fn(),
    removeSelected: vi.fn(),
    setChildren: vi.fn(),
    moveSide: vi.fn(),
    wrapNewGroup: vi.fn(),
    ...over,
  };
  return { ...base, gate: condGate(conditions, base.selected) };
}

let root: Root;
let host: HTMLDivElement;

const mount = async (c: CondBatchApi): Promise<void> => {
  await act(async () => root.render(createElement(CondBatchBar, { cond: c })));
};

const btn = (id: string): HTMLButtonElement =>
  host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

const click = (el: Element): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

const ACTION_IDS = ['cond-batch-delete', 'cond-batch-children', 'cond-batch-move', 'cond-batch-group'];

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

describe('条件批量浮条', () => {
  it('读数与全选按钮文案来自选中态;取消退出批量', async () => {
    const c = fake({ count: 3 });
    await mount(c);
    expect(host.querySelector('[data-testid="cond-batch-count"]')!.textContent).toBe('已选 3 项');
    expect(btn('cond-batch-select-all').textContent).toBe('全选');
    await click(btn('cond-batch-select-all'));
    await click(btn('cond-batch-cancel'));
    expect(c.selectAll).toHaveBeenCalledTimes(1);
    expect(c.cancel).toHaveBeenCalledTimes(1);
  });

  it('已全选时全选按钮切到「取消全选」', async () => {
    await mount(fake({ allSelected: true }));
    expect(btn('cond-batch-select-all').textContent).toBe('取消全选');
  });

  it('四个动作各接一条线:删除 / 含子级切换 / 移动 / 移入新组', async () => {
    const c = fake();
    await mount(c);
    await click(btn('cond-batch-delete'));
    await click(btn('cond-batch-children'));
    await click(btn('cond-batch-move'));
    await click(btn('cond-batch-group'));
    expect(c.removeSelected).toHaveBeenCalledTimes(1);
    expect(c.setChildren).toHaveBeenCalledWith(false); // 全是含子级 -> 按下去是「仅本级」
    expect(c.moveSide).toHaveBeenCalledTimes(1);
    expect(c.wrapNewGroup).toHaveBeenCalledTimes(1);
  });

  it('含子级按钮文案即按下效果:仅本级选中时给「含子级」,点击传 true', async () => {
    const c = fake({}, cond({ kind: 'tag', path: '工作', includeChildren: false }));
    await mount(c);
    expect(btn('cond-batch-children').textContent).toBe('含子级');
    await click(btn('cond-batch-children'));
    expect(c.setChildren).toHaveBeenCalledWith(true);
  });

  it('非标签条件选中:四个动作全禁用,并给一句中文说明(不静默跳过)', async () => {
    const c = fake({ selected: new Set(['0:0']) }, cond(kw('电影')));
    await mount(c);
    for (const id of ACTION_IDS) expect(btn(id).disabled).toBe(true);
    const reason = host.querySelector('[data-testid="cond-batch-reason"]') as HTMLElement;
    expect(reason.textContent).toContain('非标签');
    await click(btn('cond-batch-delete'));
    expect(c.removeSelected).not.toHaveBeenCalled();
  });

  it('两侧混合时只有「移动」禁用(方向二义),其余三个动作照常', async () => {
    const c = fake({ selected: new Set(['0:0', '0:1']), count: 2 }, cond(tag('a'), exTag('b')));
    await mount(c);
    expect(btn('cond-batch-move').disabled).toBe(true);
    for (const id of ['cond-batch-delete', 'cond-batch-children', 'cond-batch-group']) {
      expect(btn(id).disabled).toBe(false);
    }
    expect(host.querySelector('[data-testid="cond-batch-reason"]')!.textContent).toContain('包含侧和排除侧');
  });

  it('移动按钮文案随选中项的侧走:包含侧 -> 移到排除侧', async () => {
    await mount(fake({}, cond(tag('a'))));
    expect(btn('cond-batch-move').textContent).toBe('移到排除侧');
  });

  it('移动按钮文案随选中项的侧走:排除侧 -> 移回包含侧', async () => {
    await mount(fake({}, cond(exTag('b'))));
    expect(btn('cond-batch-move').textContent).toBe('移回包含侧');
  });
});

// @vitest-environment jsdom
/**
 * 单份筛选条件的状态与持久化(设计 2026-09-25 §2/§3)。行为口径逐条对齐 tabs 时代的
 * `use-tabs.ts`,只是从"多页"变"单份":启动读回、节流 500ms 写回、卸载补写、
 * 恢复完成前不写回、reload 从库重读(键缺失时保持当前状态)。
 * 库值为空(键缺失/坏值)时保持默认条件且**不写回**:默认值不该被当成用户改动落盘。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EMPTY_FILTER, filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { useFilterState } from './use-filter-state';
import type { FilterStateApi } from './use-filter-state';

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string): Promise<void> => {}),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });

let root: Root;
let host: HTMLDivElement;
let mounted = false;
/** 每次渲染刷新的 hook 句柄(断言必须取最新一份) */
let handle: FilterStateApi;

function Harness(): ReactNode {
  handle = useFilterState();
  return createElement('div', { 'data-testid': 'cond' }, JSON.stringify(handle.conditions));
}

const mount = (): void => {
  mounted = true;
  act(() => root.render(createElement(Harness)));
};
const unmount = (): void => {
  if (!mounted) return;
  mounted = false;
  act(() => root.unmount());
};
/** 屏幕上正在生效的条件(与生产里查询/侧栏选中态同源) */
const shown = (): FilterConditions =>
  JSON.parse(host.querySelector('[data-testid="cond"]')!.textContent ?? 'null') as FilterConditions;

/** 让在途 microtask(setState 提交 + effect)全部落地 */
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};
const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
/** 最后一次写库的载荷 */
const written = (): FilterConditions =>
  JSON.parse(setSetting.mock.calls[setSetting.mock.calls.length - 1][1]) as FilterConditions;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  getSetting.mockResolvedValue(null);
});
afterEach(() => {
  unmount();
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useFilterState 启动读回与退化', () => {
  it('启动读回:库里的完整条件成为初始状态', async () => {
    const stored = cond({
      keyword: '电影',
      tags: [{ path: '工作', includeChildren: true }],
      tagPresence: 'none',
      sort: 'oldest',
      expr: 'a>1',
    });
    getSetting.mockResolvedValueOnce(JSON.stringify(stored));
    mount();
    await settle();
    expect(getSetting).toHaveBeenCalledWith('filter_current');
    expect(filterKey(shown())).toBe(filterKey(stored));
    expect(shown()).toEqual(stored);
  });

  it('库值为空:保持默认空条件且不写回', async () => {
    mount();
    await settle();
    expect(filterKey(shown())).toBe(filterKey(EMPTY_FILTER));
    await advance(2000);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('恢复完成前不写回:读回期间改了不落盘,恢复后写的是库里的值', async () => {
    let release: (v: string | null) => void = () => {};
    getSetting.mockReturnValueOnce(new Promise<string | null>((res) => { release = res; }));
    mount();
    await act(async () => handle.patch({ keyword: '早期输入' }));
    await advance(1000);
    expect(setSetting).not.toHaveBeenCalled(); // 默认/早期值绝不在恢复前落盘

    await act(async () => release(JSON.stringify(cond({ keyword: '库里的' }))));
    await settle();
    expect(shown().keyword).toBe('库里的');
    await advance(500);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(written().keyword).toBe('库里的');
  });
});

describe('useFilterState 写回节流与卸载补写', () => {
  it('连续改动 500ms 合并成一次写回', async () => {
    mount();
    await settle();
    await act(async () => handle.patch({ keyword: 'A' }));
    await advance(200);
    await act(async () => handle.patch({ keyword: 'AB', sort: 'oldest' }));
    await advance(499);
    expect(setSetting).not.toHaveBeenCalled();
    await advance(1);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(setSetting.mock.calls[0][0]).toBe('filter_current');
    expect(written().keyword).toBe('AB');
    expect(written().sort).toBe('oldest');
  });

  it('卸载补写未落盘改动', async () => {
    mount();
    await settle();
    await act(async () => handle.patch({ keyword: '未落盘' }));
    unmount();
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(written().keyword).toBe('未落盘');
  });
});

describe('useFilterState reload 与标签开关', () => {
  it('reload 从库重读并替换本地态;键缺失时保持当前状态不动', async () => {
    getSetting.mockResolvedValueOnce(JSON.stringify(cond({ keyword: '旧' })));
    mount();
    await settle();
    await act(async () => handle.patch({ keyword: '本地改了' }));
    getSetting.mockResolvedValueOnce(JSON.stringify(cond({ keyword: 'Rust 改写的' })));
    await act(async () => handle.reload());
    await settle();
    expect(shown().keyword).toBe('Rust 改写的'); // 本地态被替换
    expect(setSetting).not.toHaveBeenCalled(); // 挂起的旧值写回被取消
    await advance(500);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(written().keyword).toBe('Rust 改写的'); // 不是「本地改了」

    getSetting.mockResolvedValueOnce(null);
    await act(async () => handle.reload());
    await settle();
    expect(shown().keyword).toBe('Rust 改写的'); // 键缺失:状态一动不动
  });

  it('toggleTag 与侧栏同口径,并进入写回队列', async () => {
    mount();
    await settle();
    await act(async () => handle.toggleTag('健康'));
    expect(shown().tags).toEqual([{ path: '健康', includeChildren: true }]);
    await advance(500);
    expect(written().tags).toEqual([{ path: '健康', includeChildren: true }]);
  });

  it('toggleTag:排除侧命中就移到包含侧', async () => {
    getSetting.mockResolvedValueOnce(
      JSON.stringify(cond({ excludeTags: [{ path: '健康', includeChildren: false }] }))
    );
    mount();
    await settle();
    await act(async () => handle.toggleTag('健康'));
    expect(shown().tags).toEqual([{ path: '健康', includeChildren: true }]);
    expect(shown().excludeTags).toEqual([]);
  });
});

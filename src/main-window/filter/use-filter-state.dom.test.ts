// @vitest-environment jsdom
/**
 * 单份筛选条件的状态与持久化(设计 2026-09-25 §2/§3):启动读回、节流 500ms 写回、卸载补写。
 * reload 与错误分支在 `use-filter-state-reload.dom.test.ts`(拆分守 200 行红线)。
 * 库值为空(键缺失/坏值)时保持默认条件且**不写回**:默认值不该被当成用户改动落盘。
 * 装配样板在 `__fixtures__/filter-state-harness.ts`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { EMPTY_FILTER, filterKey, normalizeGroups } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { keywordOf, lastWritten, mountFilterState } from './__fixtures__/filter-state-harness';
import type { MountedState } from './__fixtures__/filter-state-harness';

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string): Promise<void> => {}),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting } }));

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });
/** 历次写库载荷的关键词(用于"若有写回,值必须是库值"这类不钉实现的断言) */
const writtenKeywords = (): (string | null)[] =>
  setSetting.mock.calls.map((call) => keywordOf(lastWritten([call])));

let h: MountedState;

beforeEach(() => {
  vi.useFakeTimers();
  getSetting.mockResolvedValue(null);
  h = mountFilterState();
});
afterEach(() => {
  h.unmount();
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
      sorts: [{ kind: 'time', dir: 'asc', enabled: true }],
      expr: 'a>1',
    });
    getSetting.mockResolvedValueOnce(JSON.stringify(stored));
    h.mount();
    await h.settle();
    expect(getSetting).toHaveBeenCalledWith('filter_current');
    expect(filterKey(h.shown())).toBe(filterKey(stored));
    expect(h.shown()).toEqual(normalizeGroups(stored));
  });

  it('库值为空:保持默认空条件且不写回', async () => {
    h.mount();
    await h.settle();
    expect(filterKey(h.shown())).toBe(filterKey(EMPTY_FILTER));
    await h.advance(2000);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('恢复完成前不写回:读回期间改了不落盘,恢复后写的只能是库里的值', async () => {
    let release: (v: string | null) => void = () => {};
    getSetting.mockReturnValueOnce(new Promise<string | null>((res) => { release = res; }));
    h.mount();
    await act(async () => h.api().patch({ keyword: '早期输入' }));
    await h.advance(1000);
    expect(setSetting).not.toHaveBeenCalled(); // 默认/早期值绝不在恢复前落盘

    await act(async () => release(JSON.stringify(cond({ keyword: '库里的' }))));
    await h.settle();
    expect(keywordOf(h.shown())).toBe('库里的');
    await h.advance(500);
    // 恢复后是否再冗余回写一次是实现细节(等值抑制可能拦下),但**若写,值必须是库里的**
    expect(writtenKeywords().every((k) => k === '库里的')).toBe(true);
  });
});

describe('useFilterState 写回节流与卸载补写', () => {
  it('连续改动 500ms 合并成一次写回', async () => {
    h.mount();
    await h.settle();
    await act(async () => h.api().patch({ keyword: 'A' }));
    await h.advance(200);
    await act(async () => h.api().patch({ keyword: 'AB', sort: 'oldest' }));
    await h.advance(499);
    expect(setSetting).not.toHaveBeenCalled();
    await h.advance(1);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(setSetting.mock.calls[0][0]).toBe('filter_current');
    const written = lastWritten(setSetting.mock.calls);
    expect(keywordOf(written)).toBe('AB');
    expect(written.sort).toBe('oldest');
  });

  it('卸载补写未落盘改动', async () => {
    h.mount();
    await h.settle();
    await act(async () => h.api().patch({ keyword: '未落盘' }));
    h.unmount();
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(keywordOf(lastWritten(setSetting.mock.calls))).toBe('未落盘');
  });
});

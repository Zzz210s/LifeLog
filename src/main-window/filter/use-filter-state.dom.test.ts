// @vitest-environment jsdom
/**
 * 单份筛选条件的状态与持久化(设计 2026-09-25 §2/§3)。行为口径沿用旧标签页状态层,
 * 只是从"多页"变"单份":启动读回、节流 500ms 写回、卸载补写、
 * 恢复完成前不写回、reload 从库重读(键缺失时保持当前状态)。
 * 库值为空(键缺失/坏值)时保持默认条件且**不写回**:默认值不该被当成用户改动落盘。
 * 错误分支(启动读失败 / 写失败 / reload 读失败)在最后一个 describe。
 * 装配样板在 `__fixtures__/filter-state-harness.ts`(守本文件 200 行红线)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { EMPTY_FILTER, filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { mountFilterState } from './__fixtures__/filter-state-harness';
import type { MountedState } from './__fixtures__/filter-state-harness';

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string): Promise<void> => {}),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting } }));

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });

let h: MountedState;

/** 最后一次写库的载荷 */
const written = (): FilterConditions =>
  JSON.parse(setSetting.mock.calls[setSetting.mock.calls.length - 1][1]) as FilterConditions;
/** 历次写库载荷的关键词(用于"若有写回,值必须是库值"这类不钉实现的断言) */
const writtenKeywords = (): (string | null)[] =>
  setSetting.mock.calls.map((call) => (JSON.parse(call[1]) as FilterConditions).keyword);

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
      expr: 'a>1',
    });
    getSetting.mockResolvedValueOnce(JSON.stringify(stored));
    h.mount();
    await h.settle();
    expect(getSetting).toHaveBeenCalledWith('filter_current');
    expect(filterKey(h.shown())).toBe(filterKey(stored));
    expect(h.shown()).toEqual(stored);
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
    expect(h.shown().keyword).toBe('库里的');
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
    expect(written().keyword).toBe('AB');
    expect(written().sort).toBe('oldest');
  });

  it('卸载补写未落盘改动', async () => {
    h.mount();
    await h.settle();
    await act(async () => h.api().patch({ keyword: '未落盘' }));
    h.unmount();
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(written().keyword).toBe('未落盘');
  });
});

describe('useFilterState reload 与标签开关', () => {
  it('reload 从库重读并替换本地态;键缺失时保持当前状态不动', async () => {
    getSetting.mockResolvedValueOnce(JSON.stringify(cond({ keyword: '旧' })));
    h.mount();
    await h.settle();
    await act(async () => h.api().patch({ keyword: '本地改了' }));
    getSetting.mockResolvedValueOnce(JSON.stringify(cond({ keyword: 'Rust 改写的' })));
    await act(async () => h.api().reload());
    await h.settle();
    expect(h.shown().keyword).toBe('Rust 改写的'); // 本地态被替换
    expect(setSetting).not.toHaveBeenCalled(); // 挂起的旧值写回被取消
    await h.advance(500);
    expect(writtenKeywords().every((k) => k === 'Rust 改写的')).toBe(true); // 绝不是「本地改了」

    getSetting.mockResolvedValueOnce(null);
    await act(async () => h.api().reload());
    await h.settle();
    expect(h.shown().keyword).toBe('Rust 改写的'); // 键缺失:状态一动不动
  });

  it('toggleTag 与侧栏同口径,并进入写回队列', async () => {
    h.mount();
    await h.settle();
    await act(async () => h.api().toggleTag('健康'));
    expect(h.shown().tags).toEqual([{ path: '健康', includeChildren: true }]);
    await h.advance(500);
    expect(written().tags).toEqual([{ path: '健康', includeChildren: true }]);
  });

  it('toggleTag:排除侧命中就移到包含侧', async () => {
    getSetting.mockResolvedValueOnce(
      JSON.stringify(cond({ excludeTags: [{ path: '健康', includeChildren: false }] }))
    );
    h.mount();
    await h.settle();
    await act(async () => h.api().toggleTag('健康'));
    expect(h.shown().tags).toEqual([{ path: '健康', includeChildren: true }]);
    expect(h.shown().excludeTags).toEqual([]);
  });
});

describe('useFilterState 错误分支(读/写失败都不静默变味)', () => {
  it('启动读库失败:回落默认空条件,随后的改动照常落盘(闸门没被关上)', async () => {
    getSetting.mockRejectedValueOnce(new Error('IPC 挂了'));
    h.mount();
    await h.settle();
    expect(filterKey(h.shown())).toBe(filterKey(EMPTY_FILTER));
    await h.advance(2000);
    expect(setSetting).not.toHaveBeenCalled(); // 默认值不该被当成用户改动落盘

    await act(async () => h.api().patch({ keyword: '照常写' }));
    await h.advance(500);
    expect(written().keyword).toBe('照常写');
  });

  it('写库失败:静默吞掉,界面状态不回滚,下一次改动仍会写', async () => {
    setSetting.mockRejectedValueOnce(new Error('磁盘满'));
    h.mount();
    await h.settle();
    await act(async () => h.api().patch({ keyword: '第一次' }));
    await h.advance(500);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(h.shown().keyword).toBe('第一次'); // 写失败不回滚本次会话的筛选

    await act(async () => h.api().patch({ keyword: '第二次' }));
    await h.advance(500);
    expect(setSetting).toHaveBeenCalledTimes(2);
    expect(written().keyword).toBe('第二次');
  });

  it('reload 读库失败:保留当前状态,并且闸门已放行(后续改动仍写)', async () => {
    getSetting.mockResolvedValueOnce(JSON.stringify(cond({ keyword: '库里的' })));
    h.mount();
    await h.settle();
    getSetting.mockRejectedValueOnce(new Error('IPC 挂了'));
    await act(async () => h.api().reload());
    await h.settle();
    expect(h.shown().keyword).toBe('库里的'); // 读失败不动状态

    await act(async () => h.api().patch({ keyword: '之后' }));
    await h.advance(500);
    expect(written().keyword).toBe('之后');
  });
});

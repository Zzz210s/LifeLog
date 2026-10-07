// @vitest-environment jsdom
/**
 * `useFilterState` 的 reload 与错误分支(自 use-filter-state.dom.test.ts 拆出守 200 行):
 * reload 从库重读、标签开关同侧栏口径;读失败 / 写失败都不静默变味(闸门不被关上)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { EMPTY_FILTER, allItems, filterKey, itemPaths } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { keywordOf, lastWritten, mountFilterState } from './__fixtures__/filter-state-harness';
import type { MountedState } from './__fixtures__/filter-state-harness';

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string): Promise<void> => {}),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting } }));

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });
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

describe('useFilterState reload 与标签开关', () => {
  it('reload 从库重读并替换本地态;键缺失时保持当前状态不动', async () => {
    getSetting.mockResolvedValueOnce(JSON.stringify(cond({ keyword: '旧' })));
    h.mount();
    await h.settle();
    await act(async () => h.api().patch({ keyword: '本地改了' }));
    getSetting.mockResolvedValueOnce(JSON.stringify(cond({ keyword: 'Rust 改写的' })));
    await act(async () => h.api().reload());
    await h.settle();
    expect(keywordOf(h.shown())).toBe('Rust 改写的'); // 本地态被替换
    expect(setSetting).not.toHaveBeenCalled(); // 挂起的旧值写回被取消
    await h.advance(500);
    expect(writtenKeywords().every((k) => k === 'Rust 改写的')).toBe(true); // 绝不是「本地改了」

    getSetting.mockResolvedValueOnce(null);
    await act(async () => h.api().reload());
    await h.settle();
    expect(keywordOf(h.shown())).toBe('Rust 改写的'); // 键缺失:状态一动不动
  });

  it('toggleTag 与侧栏同口径,并进入写回队列', async () => {
    h.mount();
    await h.settle();
    await act(async () => h.api().toggleTag('健康'));
    expect(allItems(h.shown())).toEqual([{ kind: 'tag', path: '健康', includeChildren: true }]);
    await h.advance(500);
    expect(itemPaths(lastWritten(setSetting.mock.calls), 'tag')).toEqual(['健康']);
  });

  it('toggleTag:排除侧命中就移到包含侧', async () => {
    getSetting.mockResolvedValueOnce(
      JSON.stringify(cond({ excludeTags: [{ path: '健康', includeChildren: false }] }))
    );
    h.mount();
    await h.settle();
    await act(async () => h.api().toggleTag('健康'));
    expect(allItems(h.shown())).toEqual([{ kind: 'tag', path: '健康', includeChildren: true }]);
    expect(itemPaths(h.shown(), 'excludeTag')).toEqual([]);
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
    expect(keywordOf(lastWritten(setSetting.mock.calls))).toBe('照常写');
  });

  it('写库失败:静默吞掉,界面状态不回滚,下一次改动仍会写', async () => {
    setSetting.mockRejectedValueOnce(new Error('磁盘满'));
    h.mount();
    await h.settle();
    await act(async () => h.api().patch({ keyword: '第一次' }));
    await h.advance(500);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(keywordOf(h.shown())).toBe('第一次'); // 写失败不回滚本次会话的筛选

    await act(async () => h.api().patch({ keyword: '第二次' }));
    await h.advance(500);
    expect(setSetting).toHaveBeenCalledTimes(2);
    expect(keywordOf(lastWritten(setSetting.mock.calls))).toBe('第二次');
  });

  it('reload 读库失败:保留当前状态,并且闸门已放行(后续改动仍写)', async () => {
    getSetting.mockResolvedValueOnce(JSON.stringify(cond({ keyword: '库里的' })));
    h.mount();
    await h.settle();
    getSetting.mockRejectedValueOnce(new Error('IPC 挂了'));
    await act(async () => h.api().reload());
    await h.settle();
    expect(keywordOf(h.shown())).toBe('库里的'); // 读失败不动状态

    await act(async () => h.api().patch({ keyword: '之后' }));
    await h.advance(500);
    expect(keywordOf(lastWritten(setSetting.mock.calls))).toBe('之后');
  });
});

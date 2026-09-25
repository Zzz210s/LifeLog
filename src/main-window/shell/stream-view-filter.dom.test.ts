// @vitest-environment jsdom
/**
 * Task 6 的容器证据(实时筛选侧):`/` 的 300ms 防抖与提示行。
 * 装配在 `__fixtures__/stream-view-harness.ts`(与采纳副作用的用例文件共用);采纳的用例在
 * stream-view-accept.dom.test.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { installGeometryStubs, mountStreamView } from './__fixtures__/stream-view-harness';

const { getSetting, setSetting, saveInputNote } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string) => {}),
  saveInputNote: vi.fn(async (_s: string) => 1),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting, saveInputNote } }));

let onPatch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onPatch = vi.fn();
  installGeometryStubs();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('`/` 实时筛选(300ms 防抖)', () => {
  it('299ms 不写条件,300ms 后写 keyword;提示行给命中数与排序', async () => {
    vi.useFakeTimers();
    const m = await mountStreamView({ notes: [{ id: 3, content: 'UI测试笔记', created_at: '2026-09-24 10:00:00', tags: [] }], onPatch });
    await m.type('/UI测试');
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(onPatch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onPatch).toHaveBeenCalledWith({ keyword: 'UI测试' });
    expect(m.host.textContent).toContain('/ 关键词筛选 · 命中 1 条 · 最新在前');
  });

  it('连续输入只在停手后写一次(前一次被取消)', async () => {
    vi.useFakeTimers();
    const m = await mountStreamView({ onPatch });
    await m.type('/U');
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await m.type('/UI');
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(onPatch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ keyword: 'UI' });
  });

  it('挂起期间按 Esc 退模式:防抖被取消,onPatch 一次都不调', async () => {
    vi.useFakeTimers();
    const m = await mountStreamView({ onPatch });
    await m.type('/UI测试');
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    await m.press('Escape');
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(onPatch).not.toHaveBeenCalled();
  });
});

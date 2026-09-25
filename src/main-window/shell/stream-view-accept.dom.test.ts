// @vitest-environment jsdom
/**
 * Task 6 的容器证据(采纳侧):三类前缀的采纳副作用在 `StreamView` 里落地。
 * 装配在 `__fixtures__/stream-view-harness.ts`(与 `/` 实时筛选的用例文件共用,守单文件 200 行红线);
 * 决策本身(纯函数)的用例在 unified/unified-accept.test.ts;这里只钉执行与接线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import { NOTE, installGeometryStubs, mountStreamView, row } from './__fixtures__/stream-view-harness';
import { QUICK_OPEN_CLEARED_TEXT } from '../palette/quick-open';

const { getSetting, setSetting, saveInputNote } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string) => {}),
  saveInputNote: vi.fn(async (_s: string) => 1),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting, saveInputNote } }));

let onPatch: ReturnType<typeof vi.fn>;
let onRunCommand: ReturnType<typeof vi.fn>;
let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onPatch = vi.fn();
  onRunCommand = vi.fn();
  scrollSpy = vi.fn();
  installGeometryStubs();
  // jsdom 没有 scrollIntoView:几何桩把所有行放在滚动槽下方,于是能读到那次滚动
  Element.prototype.scrollIntoView = scrollSpy as unknown as Element['scrollIntoView'];
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('采纳副作用(StreamView 执行)', () => {
  it('`#` 选标签 -> 条件补丁(两侧都给,含子级),条件栏出一个包含侧 chip', async () => {
    const m = await mountStreamView({ rows: [row('UI测试')], onPatch });
    await m.type('#UI测试');
    await m.press('Enter');
    expect(onPatch).toHaveBeenCalledWith({
      tags: [{ path: 'UI测试', includeChildren: true }],
      excludeTags: [],
    });
    expect(m.chips()).toEqual(['⊢ #UI测试']);
  });

  it('排除侧已有该标签 -> 采纳后它只出现在包含侧(条件栏仍只有一个 chip)', async () => {
    const excluded: FilterConditions = { ...EMPTY_FILTER, excludeTags: [{ path: 'UI测试A', includeChildren: true }] };
    const m = await mountStreamView({ rows: [row('UI测试A')], conditions: excluded, onPatch });
    expect(m.chips()).toEqual(['排除 ⊢ #UI测试A']);
    await m.type('#UI测试A');
    await m.press('Enter');
    expect(m.chips()).toEqual(['⊢ #UI测试A']);
    expect(onPatch).toHaveBeenCalledWith({
      tags: [{ path: 'UI测试A', includeChildren: true }],
      excludeTags: [],
    });
  });

  it('`@` 选笔记 -> 滚到该条(元素在滚动容器外时滚到中间)', async () => {
    const m = await mountStreamView({ rows: [row('3')], notes: [NOTE] });
    await m.type('@UI测试');
    await m.press('Enter');
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' });
  });

  it('`@` 选一条被筛选掉的笔记 -> 清筛选 + 中文提示(不再静默无反应)', async () => {
    const onLinkError = vi.fn();
    const onClearFilters = vi.fn();
    const filtered: FilterConditions = { ...EMPTY_FILTER, keyword: '别的关键词' };
    // 候选行还在(候选池是全库),但流里没有这条 -> 旧实现 querySelector 落空、什么都不发生
    const m = await mountStreamView({
      rows: [row('3')], notes: [], conditions: filtered, onLinkError, onClearFilters,
    });
    await m.type('@UI测试');
    await m.press('Enter');
    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onLinkError).toHaveBeenCalledWith(QUICK_OPEN_CLEARED_TEXT);
  });

  it('`>` 选命令 -> 交给既有命令的 execute(不在这里重写命令)', async () => {
    const m = await mountStreamView({ rows: [row('sidebar.toggle')], onPatch, onRunCommand });
    await m.type('>侧栏');
    await m.press('Enter');
    expect(onRunCommand).toHaveBeenCalledWith('sidebar.toggle');
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('零候选时 Enter 不采纳(不产生任何副作用)', async () => {
    const m = await mountStreamView({ rows: [], onPatch, onRunCommand });
    await m.type('#UI测试');
    await m.press('Enter');
    expect(onPatch).not.toHaveBeenCalled();
    expect(onRunCommand).not.toHaveBeenCalled();
  });
});

describe('采纳即记 MRU(空闲后落盘,不是每按键写库)', () => {
  it('`@` 记笔记 MRU -> ui.mru.notes', async () => {
    vi.useFakeTimers();
    const m = await mountStreamView({ rows: [row('3')], notes: [NOTE] });
    await m.type('@UI测试');
    await m.press('Enter');
    expect(setSetting).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(setSetting).toHaveBeenCalledWith('ui.mru.notes', expect.stringContaining('"id":"3"'));
  });

  it('`#` 记标签 MRU -> ui.mru.tags', async () => {
    vi.useFakeTimers();
    const m = await mountStreamView({ rows: [row('UI测试')], onPatch });
    await m.type('#UI测试');
    await m.press('Enter');
    expect(setSetting).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(setSetting).toHaveBeenCalledWith('ui.mru.tags', expect.stringContaining('"id":"UI测试"'));
  });

  it('`>` 记命令 MRU -> ui.mru.commands', async () => {
    vi.useFakeTimers();
    const m = await mountStreamView({ rows: [row('sidebar.toggle')], onRunCommand });
    await m.type('>侧栏');
    await m.press('Enter');
    expect(setSetting).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(setSetting).toHaveBeenCalledWith('ui.mru.commands', expect.stringContaining('"id":"sidebar.toggle"'));
  });
});

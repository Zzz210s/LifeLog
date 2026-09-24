// @vitest-environment jsdom
/**
 * Task 6 的容器证据:三类前缀的采纳副作用与 `/` 实时筛选都在 `StreamView` 里落地。
 * 挂**真** `UnifiedInput`(真键盘路由)+ 桩浮层控制器(只提供行与高亮),数据层(api)换桩。
 * 决策本身(纯函数)的用例在 unified/unified-accept.test.ts;这里只钉执行与接线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import type { ListRow } from '../../shared/quickpick/model';
import type { PaletteController } from '../palette/use-palette';
import type { TabsApi } from '../tabs/use-tabs';
import { StreamView } from './StreamView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getSetting, setSetting, saveInputNote } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string) => {}),
  saveInputNote: vi.fn(async (_s: string) => 1),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting, saveInputNote } }));

// jsdom 没有 IntersectionObserver(NoteStream 的哨兵用),给个空实现
class FakeIO {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;

const NOTE: Note = { id: 3, content: 'UI测试笔记', created_at: '2026-09-24 10:00:00', tags: [] };
const row = (id: string): ListRow =>
  ({ item: { id, label: id }, score: 1, ranges: [], positions: [], pinned: false, mruCount: 0 }) as ListRow;

const tabsStub = (): TabsApi => ({
  tabs: [{ title: '全部', conditions: EMPTY_FILTER }],
  activeIndex: 0,
  conditions: EMPTY_FILTER,
  activate: () => {}, addPreset: () => {}, addFromCurrent: () => {}, close: () => {}, move: () => {},
  rename: () => {}, patch: () => {}, toggleTag: () => {}, reload: () => {},
});

let root: Root | null = null;
let host: HTMLDivElement;
let onPatch: ReturnType<typeof vi.fn>;
let onRunCommand: ReturnType<typeof vi.fn>;
let scrollSpy: ReturnType<typeof vi.fn>;

const box = () => host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
const type = async (text: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(box(), text);
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const press = async (key: string) => {
  await act(async () => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

const mount = async (rows: ListRow[] = [], notes: Note[] = []) => {
  const palette: PaletteController = {
    isOpen: false, prefix: '', query: '', rows, total: rows.length, truncated: false, activeIndex: 0,
    inputRef: { current: null }, open: () => {}, close: () => {}, setQuery: () => {}, setPrefix: () => {},
    setActiveIndex: () => {}, accept: () => {}, handleKeyDown: () => {},
  };
  const props: Parameters<typeof StreamView>[0] = {
    visible: true, tabs: tabsStub(), conditions: EMPTY_FILTER, notes, editingId: null, hasMore: false,
    loading: false, queryFailed: false, filterEmpty: true, exporting: false, exported: false, errors: {},
    onPatch, onToggleTag: () => {}, onExport: () => {}, onRetry: () => {}, onDismissError: () => {},
    onClearFilters: () => {}, onShowInput: () => {}, onLoadMore: () => {}, onEdit: () => {},
    onSwitchEdit: () => {}, onDelete: () => {}, onEditSaved: () => {}, onEditCancel: () => {},
    onToggleTask: () => {}, onLinkError: () => {}, palette, decorations: {}, tagsVersion: 0,
    onSaved: () => {}, onRunCommand,
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(StreamView, props)));
  await settle();
};

beforeEach(() => {
  onPatch = vi.fn();
  onRunCommand = vi.fn();
  scrollSpy = vi.fn();
  // jsdom 没有 scrollIntoView;一律把行判成"在视野外",这样能读到那次滚动
  Element.prototype.scrollIntoView = scrollSpy as unknown as Element['scrollIntoView'];
  Element.prototype.getBoundingClientRect = () => ({ top: 5000, bottom: 5060 }) as DOMRect;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('采纳副作用与实时筛选(StreamView 执行)', () => {
  it('`#` 选标签 -> 条件补丁(tags 含子级),不重复加', async () => {
    await mount([row('UI测试')]);
    await type('#UI测试');
    await press('Enter');
    expect(onPatch).toHaveBeenCalledWith({ tags: [{ path: 'UI测试', includeChildren: true }] });
  });

  it('`@` 选笔记 -> 滚到该条(元素在视野外时滚到中间)', async () => {
    await mount([row('3')], [NOTE]);
    await type('@UI测试');
    await press('Enter');
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' });
  });

  it('`>` 选命令 -> 交给既有命令的 execute(不在这里重写命令)', async () => {
    await mount([row('sidebar.toggle')]);
    await type('>侧栏');
    await press('Enter');
    expect(onRunCommand).toHaveBeenCalledWith('sidebar.toggle');
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('采纳即记 MRU:空闲后落盘(不是每按键写库)', async () => {
    vi.useFakeTimers();
    await mount([row('3')], [NOTE]);
    await type('@UI测试');
    await press('Enter');
    expect(setSetting).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(setSetting).toHaveBeenCalledWith('ui.mru.notes', expect.stringContaining('"id":"3"'));
  });

  it('零候选时 Enter 不采纳(不产生任何副作用)', async () => {
    await mount([]);
    await type('#UI测试');
    await press('Enter');
    expect(onPatch).not.toHaveBeenCalled();
    expect(onRunCommand).not.toHaveBeenCalled();
  });
});

describe('`/` 实时筛选(300ms 防抖)', () => {
  it('299ms 不写条件,300ms 后写 keyword;提示行给命中数与排序', async () => {
    vi.useFakeTimers();
    await mount([], [NOTE]);
    await type('/UI测试');
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(onPatch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onPatch).toHaveBeenCalledWith({ keyword: 'UI测试' });
    expect(host.textContent).toContain('/ 关键词筛选 · 命中 1 条 · 最新在前');
  });

  it('连续输入只在停手后写一次(前一次被取消)', async () => {
    vi.useFakeTimers();
    await mount();
    await type('/U');
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await type('/UI');
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(onPatch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ keyword: 'UI' });
  });
});

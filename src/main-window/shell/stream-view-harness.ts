// @vitest-environment jsdom
/**
 * StreamView 的测试装配(自 stream-view-accept.dom.test.ts 抽出:两份用例文件共用,且单文件守 200 行红线)。
 *
 * 挂**真** `UnifiedInput`(真键盘路由)+ 桩浮层控制器(只提供行与高亮),数据层(api)由各用例文件
 * 自己 `vi.mock`(vi.mock 必须写在用例文件里:助手的静态 import 先于助手模块体执行,写在这里会太晚)。
 * 这里只给"造数据 + 打字 + 按键 + 几何桩"这些与断言无关的样板。
 */
import { act, createElement, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import type { ListRow } from '../../shared/quickpick/model';
import type { PaletteController } from '../palette/use-palette';
import type { TabsApi } from '../tabs/use-tabs';
import { StreamView } from './StreamView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 没有 IntersectionObserver(NoteStream 的哨兵用),给个空实现
class FakeIO {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;

/** 一条笔记(信息流渲染用) */
export const NOTE: Note = { id: 3, content: 'UI测试笔记', created_at: '2026-09-24 10:00:00', tags: [] };

/** 一行候选(列表模型的行:id 在 item.id) */
export const row = (id: string): ListRow =>
  ({ item: { id, label: id }, score: 1, ranges: [], positions: [], pinned: false, mruCount: 0 }) as ListRow;

const tabsStub = (): TabsApi => ({
  tabs: [{ title: '全部', conditions: EMPTY_FILTER }],
  activeIndex: 0,
  conditions: EMPTY_FILTER,
  activate: () => {}, addPreset: () => {}, addFromCurrent: () => {}, close: () => {}, move: () => {},
  rename: () => {}, patch: () => {}, toggleTag: () => {}, reload: () => {},
});

/**
 * 几何桩:信息流滚动槽 `.scroll-gutter` 视口为 [0,500],其余元素一律在其**下方**
 * (top/bottom = 5000/5060)—— 这样"滚到笔记"才有一次真实的滚动可断言。
 */
export function installGeometryStubs(): void {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.classList.contains('scroll-gutter')
      ? ({ top: 0, bottom: 500 } as DOMRect)
      : ({ top: 5000, bottom: 5060 } as DOMRect);
  };
}

export interface MountOptions {
  rows?: ListRow[];
  notes?: Note[];
  conditions?: FilterConditions;
  onPatch?: (value: Partial<FilterConditions>) => void;
  onRunCommand?: (id: string) => void;
  /** 统一错误条出口(`@` 采纳的兜底提示走这里) */
  onLinkError?: (message: string) => void;
  /** 清筛选出口(`@` 目标不在当前结果里时被调) */
  onClearFilters?: () => void;
}

export interface Mounted {
  host: HTMLDivElement;
  /** 受控输入:经原型 setter + input 事件(React 受控文本域的既有做法) */
  type: (text: string) => Promise<void>;
  press: (key: string) => Promise<void>;
  /** 条件栏 chip 文案(含「排除」前缀);空条件时为空数组 */
  chips: () => string[];
  unmount: () => void;
}

/** 挂 StreamView:返回 host 与打字/按键助手(每条用例各自 mount/清理,不共享状态) */
export async function mountStreamView(o: MountOptions = {}): Promise<Mounted> {
  const rows = o.rows ?? [];
  const initial = o.conditions ?? EMPTY_FILTER;
  const palette: PaletteController = {
    isOpen: false, prefix: '', query: '', rows, total: rows.length, truncated: false, activeIndex: 0,
    inputRef: { current: null }, open: () => {}, close: () => {}, setQuery: () => {}, setPrefix: () => {},
    setActiveIndex: () => {}, accept: () => {}, handleKeyDown: () => {},
  };
  const props: Parameters<typeof StreamView>[0] = {
    visible: true, tabs: tabsStub(), conditions: initial, notes: o.notes ?? [],
    editingId: null, hasMore: false, loading: false, queryFailed: false, filterEmpty: true,
    errors: {}, onPatch: o.onPatch ?? (() => {}),
    onToggleTag: () => {}, onRetry: () => {}, onDismissError: () => {},
    onClearFilters: o.onClearFilters ?? (() => {}), onShowInput: () => {}, onLoadMore: () => {}, onEdit: () => {},
    onSwitchEdit: () => {}, onDelete: () => {}, onEditSaved: () => {}, onEditCancel: () => {},
    onToggleTask: () => {}, onLinkError: o.onLinkError ?? (() => {}), palette, decorations: {}, tagsVersion: 0,
    onSaved: () => {}, onRunCommand: o.onRunCommand ?? (() => {}),
    addConditionOpen: false, onAddConditionOpenChange: () => {},
    unifiedRef: { current: null },
  };
  /**
   * 条件宿主:补丁先在这里落地(与 App 的 `patchActive` 同构:`{ ...conditions, ...patch }`),
   * 再交给断言桩 —— 这样条件栏的 chip 反映的是补丁**全量**,少给 `excludeTags` 会当场多出一个 chip。
   */
  function Host(): ReactNode {
    const [conds, setConds] = useState<FilterConditions>(initial);
    return createElement(StreamView, {
      ...props,
      conditions: conds,
      onPatch: (v: Partial<FilterConditions>) => {
        o.onPatch?.(v);
        setConds((c) => ({ ...c, ...v }));
      },
    });
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Host)));
  const settle = async () => {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  };
  await settle();
  const box = () => host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
  return {
    host,
    /** 条件栏 chip 文案(含「排除」前缀);空条件时为空数组 */
    chips: () =>
      Array.from(host.querySelectorAll('[aria-label="已生效的筛选条件"] [aria-label^="移除条件"]')).map((b) =>
        (b.getAttribute('aria-label') ?? '').replace('移除条件 ', '')
      ),
    type: async (text: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(box(), text);
        box().dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    press: async (key: string) => {
      await act(async () => {
        box().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    },
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

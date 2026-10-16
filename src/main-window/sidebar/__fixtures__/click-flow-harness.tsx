// @vitest-environment jsdom
/**
 * T4 接线层的端到端夹具(仅测试):按 App / ViewHost 的形状把三处消费口接在一起 ——
 * `useTagClick`(状态 + 执行)、`TagsSection`(行 / 头部模式按钮)、信息流首部的
 * `TagPreviewCard`,外加设置页那一行(钉住"两个入口读写同一份模式状态")。
 * 条件侧走**真实**的 `applyFilterPatch`,每次变化后的原文(`filterKey`)记进 `writes` ——
 * 于是"open 不改条件"读到的是写库条数不变,而不是"回调没被调过"。
 * 2026-10-16 两档化:`cursorBar` 只留作反向断言(select 删除后它必须恒为 null)。
 */
import { act, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { EMPTY_FILTER, filterKey } from '../../../shared/filter-conditions';
import type { FilterConditions } from '../../../shared/filter-conditions';
import type { TagCount } from '../../../shared/types';
import { applyFilterPatch } from '../../filter/filter-state';
import type { MainView } from '../../settings/settings-model';
import { SidebarClickModeRow } from '../../settings/SidebarClickModeRow';
import { TagPreviewCard } from '../../shell/TagPreviewCard';
import { TagsSection } from '../TagsSection';
import type { SidebarClickMode } from '../click-mode';
import { useTagClick } from '../use-tag-click';

/** 侧栏行:可选叶子 / 有子级的容器(计数 0) / 无子级的空实体(计数 0)各一,覆盖三种行 */
export const ROWS: TagCount[] = [
  { id: 1, path: '书籍', depth: 1, sort_order: 0, self_count: 1, subtree_count: 3 },
  { id: 2, path: '书籍/SQL', depth: 2, sort_order: 0, self_count: 1, subtree_count: 2 },
  { id: 3, path: '书籍/SQL/索引', depth: 3, sort_order: 0, self_count: 1, subtree_count: 1 },
  { id: 4, path: '容器', depth: 1, sort_order: 1, self_count: 0, subtree_count: 0 },
  { id: 5, path: '容器/空', depth: 2, sort_order: 0, self_count: 0, subtree_count: 0 },
  { id: 6, path: '空实体', depth: 1, sort_order: 2, self_count: 0, subtree_count: 0 },
];

export interface ClickFlowProbe {
  /** 每次条件变化后的条件原文(filterKey):第 0 条 = 挂载时的空条件,长度即写库次数 */
  writes: string[];
  conditions: FilterConditions;
  view: MainView;
}

export interface ClickFlow {
  host: HTMLDivElement;
  probe: ClickFlowProbe;
  /** 换一份 tagRows(标签被删 / 改名后引用它的状态该失效) */
  setRows: (rows: TagCount[]) => void;
  /** 切视图(设置页 / 关系图):光标与卡片**不清**(设计 R5) */
  setView: (view: MainView) => void;
  row: (path: string) => HTMLElement | null;
  clickRow: (path: string, mods?: MouseEventInit) => void;
  blankClick: () => void;
  /** 合成拖拽起手(手法与 __fixtures__/drag-harness 一致:普通 Event + 替身 dataTransfer) */
  dragRow: (path: string) => void;
  clickHeader: () => void;
  clickSettings: (label: string) => void;
  press: (label: string) => void;
  mode: () => string | null;
  /** 反向断言用:select 删除后底部光标条不该存在(恒 null) */
  cursorBar: () => HTMLElement | null;
  card: () => HTMLElement | null;
  cards: () => HTMLElement[];
  flash: () => string | null;
  esc: () => void;
  /** 浮层先吃 Esc(useDismiss 的手法:捕获阶段 stopPropagation) */
  escWithOverlay: () => void;
  unmount: () => void;
}

interface HarnessProps {
  probe: ClickFlowProbe;
  rowsRef: { set: (rows: TagCount[]) => void };
  viewRef: { set: (view: MainView) => void };
  initialMode: SidebarClickMode;
  initialView: MainView;
}

function Harness({ probe, rowsRef, viewRef, initialMode, initialView }: HarnessProps): ReactNode {
  const [conditions, setConditions] = useState<FilterConditions>(EMPTY_FILTER);
  const [mode, setMode] = useState<SidebarClickMode>(initialMode);
  const [view, setView] = useState<MainView>(initialView);
  const [rows, setRows] = useState<TagCount[]>(ROWS);
  rowsRef.set = setRows;
  viewRef.set = setView;

  // 条件写库的真实形状:每次变化回填读数(挂载时那次就是"空条件")
  useEffect(() => {
    probe.writes.push(filterKey(conditions));
  }, [conditions, probe]);
  useEffect(() => {
    probe.conditions = conditions;
    probe.view = view;
  });

  const onPatch = useCallback(
    (v: Partial<FilterConditions>) => setConditions((c) => applyFilterPatch(c, v)),
    []
  );
  const click = useTagClick(
    { clickMode: mode, setClickMode: setMode },
    {
      conditions,
      onPatch,
      rows,
      inStream: view === 'stream',
      openStream: () => setView('stream'),
    }
  );

  return (
    <>
      <TagsSection
        conditions={conditions}
        onPatch={onPatch}
        tagRows={rows}
        tagMru={null}
        mode="tree"
        onModeChange={() => {}}
        onFilterTags={() => {}}
        onTagsMutated={() => {}}
        click={click}
      />
      {click.preview !== null && <TagPreviewCard {...click.preview} />}
      <SidebarClickModeRow value={mode} onChange={click.changeClickMode} />
    </>
  );
}

export function mountClickFlow(over: { mode: SidebarClickMode; view?: MainView }): ClickFlow {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const probe: ClickFlowProbe = { writes: [], conditions: EMPTY_FILTER, view: over.view ?? 'stream' };
  const rowsRef = { set: (_rows: TagCount[]): void => {} };
  const viewRef = { set: (_view: MainView): void => {} };
  act(() => {
    root.render(
      <Harness
        probe={probe}
        rowsRef={rowsRef}
        viewRef={viewRef}
        initialMode={over.mode}
        initialView={over.view ?? 'stream'}
      />
    );
  });

  const el = (selector: string): HTMLElement | null => host.querySelector(selector) as HTMLElement | null;
  /** 夹具里拿不到锚点就直接抛:比 null 断言读起来清楚 */
  const need = (node: HTMLElement | null, what: string): HTMLElement => {
    if (node === null) throw new Error(`夹具里没有 ${what}`);
    return node;
  };
  const fire = (node: HTMLElement, ev: Event): void => { act(() => { node.dispatchEvent(ev); }); };
  const handle: ClickFlow = {
    host,
    probe,
    setRows: (rows) => act(() => rowsRef.set(rows)),
    setView: (view) => act(() => viewRef.set(view)),
    row: (path) => el(`[data-tag-path="${path}"]`),
    clickRow: (path, mods = {}) => {
      fire(need(handle.row(path), `标签行 ${path}`), new MouseEvent('click', { bubbles: true, ...mods }));
    },
    blankClick: () => {
      fire(need(el('[data-testid="tag-list"]'), '列表容器'), new MouseEvent('click', { bubbles: true }));
    },
    dragRow: (path) => {
      // 合成拖拽起手的手法与 __fixtures__/drag-harness 一致:普通 Event + 替身 dataTransfer
      const ev = new Event('dragstart', { bubbles: true, cancelable: true });
      const dt = { effectAllowed: 'none', dropEffect: 'none', setDragImage: () => {} };
      Object.defineProperties(ev, { dataTransfer: { value: dt }, clientX: { value: 10 }, clientY: { value: 10 } });
      fire(need(handle.row(path), `标签行 ${path}`), ev);
    },
    clickHeader: () => handle.press('点击行为'),
    clickSettings: (label) => {
      const group = host.querySelector('[role="group"][aria-label="单击实体行的行为"]');
      const btns = [...(group?.querySelectorAll('button') ?? [])];
      fire(need(btns.find((b) => b.textContent?.trim() === label) as HTMLElement, `设置页「${label}」档`), new MouseEvent('click', { bubbles: true }));
    },
    press: (label) => {
      fire(need(el(`[aria-label^="${label}"]`), `aria-label 以「${label}」开头的按钮`), new MouseEvent('click', { bubbles: true }));
    },
    mode: () => el('[data-testid="click-mode-button"]')?.getAttribute('data-click-mode') ?? null,
    cursorBar: () => el('[data-testid="tag-cursor-bar"]'),
    card: () => el('[data-testid="tag-preview-card"]'),
    cards: () => [...host.querySelectorAll('[data-testid="tag-preview-card"]')] as HTMLElement[],
    flash: () => el('[data-testid="tag-flash"]')?.textContent ?? null,
    esc: () => { fire(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); },
    escWithOverlay: () => {
      const swallow = (e: Event): void => e.stopPropagation();
      document.addEventListener('keydown', swallow, true);
      handle.esc();
      document.removeEventListener('keydown', swallow, true);
    },
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
  return handle;
}

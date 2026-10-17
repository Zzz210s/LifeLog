// @vitest-environment jsdom
/**
 * T4 接线层的端到端夹具(仅测试):按 App / ViewHost 的形状把三处消费口接在一起 ——
 * `useTagClick`(状态 + 执行)、`TagsSection`(行)、信息流首部的
 * `TagPreviewCard`,外加设置页那一行(2026-10-17 起它是单击行为**唯一**入口)。
 * 条件侧走**真实**的 `applyFilterPatch`,每次变化后的原文(`filterKey`)记进 `writes` ——
 * 于是"open 不改条件"读到的是写库条数不变,而不是"回调没被调过"。
 * 2026-10-17:预览卡片退到**双击** —— `dblclickRow` 只派发 `dblclick`;真浏览器还会先发两次
 * `click`(`doubleClickRow` 就是这个序列)。形状与行数据住 `click-flow-types.ts`(守 200 行红线),
 * 本文件只留挂载与事件合成;`ROWS` 与两个接口仍从这里再出口,调用侧不用改。
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
import { CLICK_MODE_LABELS } from '../click-mode';
import { useTagClick } from '../use-tag-click';
import { ROWS, type ClickFlow, type ClickFlowProbe } from './click-flow-types';

/** 消费侧仍从本文件取(`click-flow-types.ts` 的再出口) */
export { ROWS } from './click-flow-types';
export type { ClickFlow, ClickFlowProbe } from './click-flow-types';

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
    dblclickRow: (path) => {
      fire(need(handle.row(path), `标签行 ${path}`), new MouseEvent('dblclick', { bubbles: true }));
    },
    doubleClickRow: (path) => {
      handle.clickRow(path);
      handle.clickRow(path);
      handle.dblclickRow(path);
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
    clickSettings: (label) => {
      const group = host.querySelector('[role="group"][aria-label="单击实体行的行为"]');
      const btns = [...(group?.querySelectorAll('button') ?? [])];
      fire(need(btns.find((b) => b.textContent?.trim() === label) as HTMLElement, `设置页「${label}」档`), new MouseEvent('click', { bubbles: true }));
    },
    press: (label) => {
      fire(need(el(`[aria-label^="${label}"]`), `aria-label 以「${label}」开头的按钮`), new MouseEvent('click', { bubbles: true }));
    },
    mode: () => {
      // 模式读数走设置页那一行的分段控件(头部按钮已于 2026-10-17 删除)
      const pressed = host.querySelector('[role="group"][aria-label="单击实体行的行为"] button[aria-pressed="true"]');
      const label = pressed?.textContent?.trim();
      return Object.entries(CLICK_MODE_LABELS).find(([, l]) => l === label)?.[0] ?? null;
    },
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

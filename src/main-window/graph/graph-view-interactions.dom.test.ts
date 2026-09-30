// @vitest-environment jsdom
/**
 * GraphView 的指针接线面(Task 5):悬停 -> 气泡 + 强调态重建 plan 并重绘、
 * 单击 -> 信息条/点空白清选中、覆盖层上的点击不再冒泡成画布点击、「筛到信息流」把路径交给上层、
 * 右键命中 -> 侧栏标签菜单。
 *
 * 节点屏幕位置用视图同一套纯函数现算(`visibleGraph` -> `radialLayout` -> `fitToView` -> `screenOf`),
 * 免得把布局算式抄成第二份而悄悄漂移;jsdom 里容器原点为 0,所以画布坐标就是 client 坐标。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { makeCanvasCtx, type CanvasCtxStub } from './canvas-test-kit';
import { fitToView, screenOf } from './graph-camera';
import { collapseRootsOf, visibleGraph } from './graph-view-model';
import { radialLayout } from './radial';
import { normalizeTemplate } from '../settings/time-tag-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NODES = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 4, selfCount: 4, sortOrder: 0 },
  { id: 2, path: '甲/一', depth: 2, parent: 1, notes: 4, selfCount: 2, sortOrder: 0 },
  { id: 3, path: '丙', depth: 1, parent: null, notes: 4, selfCount: 4, sortOrder: 0 },
];
const EDGES = [{ a: 1, b: 2, kind: 'tree' as const, weight: 1 }];
const DATA = { nodes: NODES, edges: EDGES };

const { graphData } = vi.hoisted(() => ({
  graphData: vi.fn(async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => ({ nodes: [], edges: [] })),
}));
// getSetting 恒 null:模板取默认值(根名在夹具里不存在 -> 一根都不折),graph_positions 也没有记忆
vi.mock('../../shared/api', () => ({
  api: { graphData, getSetting: vi.fn(async () => null), setSetting: vi.fn(async () => undefined) },
}));

import { GraphView } from './GraphView';

const W = 400;
const H = 300;
/** 视图那条流水线的镜像:模板为 null -> 默认模板 -> 折叠根不在夹具里 -> 两个节点都可见 */
const VISIBLE = visibleGraph(DATA, { collapsedRoots: collapseRootsOf(normalizeTemplate(null)) }).nodes;
const LAYOUT = radialLayout(VISIBLE, { layerGap: 90 });
const CAM = fitToView([...LAYOUT.values()], W, H);

/** 节点在画布上的位置(即 client 坐标) */
const at = (id: number): { clientX: number; clientY: number } => {
  const s = screenOf(LAYOUT.get(id)!, CAM);
  return { clientX: s.x, clientY: s.y };
};

let root: Root;
let host: HTMLDivElement;
let onFilter: ReturnType<typeof vi.fn>;
/** 画布上下文替身:每次重绘都会再取一次上下文,调用次数就是「重绘了几次」;jsdom 自身会为未实现的 getContext 打 console.error,先装上它 */
let getContext: MockInstance<HTMLCanvasElement['getContext']>;
let ctx: CanvasCtxStub;

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(GraphView, { onExit: () => {}, onFilterToStream: onFilter }));
  });
  await act(async () => {
    await Promise.resolve(); // 设置与数据的回包落地
  });
};

const el = (): HTMLElement => host.querySelector('[data-testid="graph-view"]') as HTMLElement;

const fire = async (type: string, point: { clientX: number; clientY: number }): Promise<void> => {
  await act(async () => {
    el().dispatchEvent(new MouseEvent(type, { ...point, bubbles: true }));
  });
};

/** 容器实测尺寸的可变读数(jsdom 没有布局引擎,只能在原型上挂 getter) */
const metrics = (): (() => void) => {
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { get: () => W, configurable: true });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { get: () => H, configurable: true });
  return () => {
    delete (HTMLDivElement.prototype as { clientWidth?: unknown }).clientWidth;
    delete (HTMLDivElement.prototype as { clientHeight?: unknown }).clientHeight;
  };
};

beforeEach(() => {
  graphData.mockClear();
  graphData.mockResolvedValue(DATA);
  onFilter = vi.fn();
  ctx = makeCanvasCtx();
  getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('GraphView:悬停', () => {
  it('命中节点:气泡给出路径与两个计数,且画布因强调态重建 plan 而重绘', async () => {
    const restore = metrics();
    try {
      await mount();
      expect(ctx.writes.globalAlpha).not.toContain(0.2); // 没有焦点:谁都不弱化
      const before = getContext.mock.calls.length;
      await fire('pointermove', at(1));
      expect(host.textContent).toContain('甲 · 本级 4 条 / 含子级 4 条');
      // emphasis 不在 plan 依赖里时,plan 引用不变 -> 画布判定"没变" -> 这里一次重绘都没有
      expect(getContext.mock.calls.length).toBeGreaterThan(before);
      // 悬停的节点与 1 不相干(丙)必须被弱化:强调态真吃了 hovered,不是只换了个气泡
      expect(ctx.writes.globalAlpha).toContain(0.2);
      await fire('pointermove', { clientX: 2, clientY: 2 }); // 移出:气泡收起
      expect(host.textContent).not.toContain('本级 4');
    } finally {
      restore();
    }
  });
});

describe('GraphView:单击与信息条', () => {
  it('单击选中 -> 信息条给出路径与计数;点「筛到信息流」把该路径交给上层且选中不被覆盖层点击清掉', async () => {
    const restore = metrics();
    try {
      await mount();
      await fire('click', at(1));
      const bar = (): Element | null => host.querySelector('[data-testid="graph-info-bar"]');
      expect(bar()?.textContent).toContain('甲');
      expect(bar()?.textContent).toContain('本级 4 · 含子级 4');
      const btn = [...host.querySelectorAll('button')].find((b) =>
        b.textContent!.includes('筛到信息流'),
      )!;
      await act(async () => {
        btn.click();
      });
      expect(onFilter).toHaveBeenCalledWith('甲');
      // 覆盖层(data-graph-overlay)上的 click 不该冒泡成画布点击:否则选中先被清、信息条当场消失
      expect(bar()).not.toBeNull();
    } finally {
      restore();
    }
  });

  it('单击空白 -> 清选中,信息条消失', async () => {
    const restore = metrics();
    try {
      await mount();
      await fire('click', at(1));
      expect(host.querySelector('[data-testid="graph-info-bar"]')).not.toBeNull();
      await fire('click', { clientX: 4, clientY: 4 });
      expect(host.querySelector('[data-testid="graph-info-bar"]')).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('GraphView:右键标签菜单', () => {
  it('右键命中 -> 出侧栏标签菜单(标题是该路径);右键空白不出菜单', async () => {
    const restore = metrics();
    try {
      await mount();
      await fire('contextmenu', { clientX: 4, clientY: 4 });
      expect(host.querySelector('[data-tag-menu]')).toBeNull(); // 空白处右键:什么都不开
      await fire('contextmenu', at(2));
      const menu = host.querySelector('[data-tag-menu]');
      expect(menu).not.toBeNull();
      expect(menu?.textContent).toContain('甲/一');
    } finally {
      restore();
    }
  });
});

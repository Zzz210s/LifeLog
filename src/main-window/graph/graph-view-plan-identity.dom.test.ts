// @vitest-environment jsdom
/**
 * 展开层的身份稳定(view 级收口,G3 Task 6):
 * 同一份数据重渲染时,喂给画布的 `plan` 必须是**同一个对象** —— 画布按引用判等,换了对象就整图重绘
 * (设计 §3.3 的「静止 0 CPU」)。plan 的依赖里只有 `expanded` 是视图侧现攒的一位
 * (节点/边/相机/落点都是别处身份稳定的对象),它一换对象,上面的 memo 白重建没人看得出来。
 *
 * 手法:把 `GraphCanvas` 换成只记 `plan` 的替身,每次渲染记一笔 —— "重建没重建"于是成了逐对象可比的事实,
 * 而不是"看代码觉得它稳"。对照组(强调态变了必须重建)用来证明这条不是"永远同一个对象"的假绿。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import type { DrawPlan } from './graph-draw-plan';
import { fitToView, screenOf } from './graph-camera';
import { collapseRootsOf, visibleGraph } from './graph-view-model';
import { radialLayout } from './radial';
import { normalizeTemplate } from '../settings/time-tag-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 每次 `GraphCanvas` 渲染拿到的 plan(引用):同一个对象就是「没有重建」 */
const PLANS = vi.hoisted(() => [] as unknown[]);
vi.mock('./GraphCanvas', () => ({
  GraphCanvas: (p: { plan: DrawPlan }) => {
    PLANS.push(p.plan);
    return null;
  },
}));

/** 节点 1 有 414 条(展开画 20 个圆 + `+394`);节点 2 只是个小标签 */
const NODES = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 414, selfCount: 4, sortOrder: 0 },
  { id: 2, path: '丙', depth: 1, parent: null, notes: 9, selfCount: 9, sortOrder: 0 },
];
const DATA = { nodes: NODES, edges: [] };

const { graphData, queryNotes } = vi.hoisted(() => ({
  graphData: vi.fn(async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => ({ nodes: [], edges: [] })),
  queryNotes: vi.fn(async (): Promise<Note[]> => []),
}));
vi.mock('../../shared/api', () => ({
  api: { graphData, queryNotes, getSetting: vi.fn(async () => null), setSetting: vi.fn(async () => undefined) },
}));

import { GraphView } from './GraphView';

const W = 400;
const H = 300;
/** 视图那条流水线的镜像:模板为 null -> 默认模板 -> 折叠根不在夹具里 -> 两个节点都可见 */
const VISIBLE = visibleGraph(DATA, { collapsedRoots: collapseRootsOf(normalizeTemplate(null)) }).nodes;
const LAYOUT = radialLayout(VISIBLE, { layerGap: 90 });
const CAM = fitToView([...LAYOUT.values()], W, H);

/** 节点在画布上的位置(jsdom 里容器原点为 0,画布坐标就是 client 坐标) */
const at = (id: number): { clientX: number; clientY: number } => {
  const s = screenOf(LAYOUT.get(id)!, CAM);
  return { clientX: s.x, clientY: s.y };
};

let root: Root;
let host: HTMLDivElement;

/** 挂载 / 重渲染:每次都是**新的 props 对象**但数据一点没变(React 因此会真的重渲染一遍) */
const render = async (): Promise<void> => {
  await act(async () => {
    root.render(
      createElement(GraphView, { dataVersion: 0, onExit: () => {}, onFilterToStream: () => {} }),
    );
  });
};

/** 再 flush 一轮微任务(取数回包 -> 状态 -> 重绘) */
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
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

/** 最后那次 plan 的读数(没渲染过就抛:用例自己该先确认画布被画过) */
const lastPlan = (): DrawPlan => {
  const p = PLANS[PLANS.length - 1];
  if (p === undefined) throw new Error('GraphCanvas 一次都没渲染');
  return p as DrawPlan;
};

beforeEach(() => {
  PLANS.length = 0;
  graphData.mockClear();
  graphData.mockResolvedValue(DATA);
  queryNotes.mockClear();
  queryNotes.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }) as Note));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('GraphView:plan 的身份稳定', () => {
  it('展开后同一份数据重渲染:plan 还是原来那个对象(展开层没被重建)', async () => {
    const restore = metrics();
    try {
      await render();
      await fire('dblclick', at(1)); // 展开节点 1
      await flush();
      const first = lastPlan();
      // 展开真的进了 plan(小圆那一层):否则下面那条会因为"没有可重建的东西"而假绿
      expect(first.notes).toHaveLength(20);
      const renders = PLANS.length;
      await render(); // 新 props 对象、同一份数据
      expect(PLANS.length).toBeGreaterThan(renders); // 确实又渲染了一次
      expect(lastPlan()).toBe(first); // 但 plan 引用没变 -> 画布一次都不会重绘
    } finally {
      restore();
    }
  });

  it('对照组:强调态变了就重建 plan(证明上一条不是"永远同一个对象")', async () => {
    const restore = metrics();
    try {
      await render();
      await fire('dblclick', at(1));
      await flush();
      const expanded = lastPlan();
      await fire('pointermove', at(2)); // 焦点换到另一个节点 -> emphasis 换对象
      expect(lastPlan()).not.toBe(expanded);
    } finally {
      restore();
    }
  });
});

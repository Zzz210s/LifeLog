// @vitest-environment jsdom
/**
 * GraphView 的数据版本接线(G3 Task 5):版本变了重取图数据,版本不变不重取;
 * 重载**只换 data** —— 相机(缩放档)、选中(信息条)、展开(笔记小圆)都不复位。
 *
 * 相机口径靠"先缩放再看点位":重载若顺手 fit 一次,点位就回不到缩放后的样子。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { makeCanvasCtx, type CanvasCtxStub } from './canvas-test-kit';
import { fitToView, screenOf } from './graph-camera';
import { collapseRootsOf, visibleGraph } from './graph-view-model';
import { radialLayout } from './radial';
import { normalizeTemplate } from '../settings/time-tag-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NODES = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 414, selfCount: 4, sortOrder: 0 },
  { id: 2, path: '乙', depth: 1, parent: null, notes: 9, selfCount: 9, sortOrder: 0 },
];
const DATA = { nodes: NODES, edges: [] };

const { graphData, queryNotes } = vi.hoisted(() => ({
  graphData: vi.fn(async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => ({ nodes: [], edges: [] })),
  queryNotes: vi.fn(async (): Promise<Note[]> => []),
}));
vi.mock('../../shared/api', () => ({
  api: {
    graphData,
    queryNotes,
    getSetting: vi.fn(async () => null),
    setSetting: vi.fn(async () => undefined),
  },
}));

import { GraphView } from './GraphView';

const W = 400;
const H = 300;
const VISIBLE = visibleGraph(DATA, { collapsedRoots: collapseRootsOf(normalizeTemplate(null)) }).nodes;
const LAYOUT = radialLayout(VISIBLE, { layerGap: 90 });
const CAM = fitToView([...LAYOUT.values()], W, H);

/** 节点在画布上的 client 位置(jsdom 里容器原点为 0) */
const at = (id: number): { clientX: number; clientY: number } => {
  const s = screenOf(LAYOUT.get(id)!, CAM);
  return { clientX: s.x, clientY: s.y };
};

let root: Root;
let host: HTMLDivElement;
let ctx: CanvasCtxStub;
let restoreMetrics: () => void;

const mount = async (dataVersion: number): Promise<void> => {
  await act(async () => {
    root.render(createElement(GraphView, { dataVersion, onExit: () => {}, onFilterToStream: () => {} }));
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const el = (): HTMLElement => host.querySelector('[data-testid="graph-view"]') as HTMLElement;

const fire = async (type: string, p: { clientX: number; clientY: number }): Promise<void> => {
  await act(async () => {
    el().dispatchEvent(new MouseEvent(type, { ...p, bubbles: true }));
  });
};

const key = async (k: string): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
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

/** 每次 arc 的 (x, y, r):点位与半径合起来就是相机 + 布局的读数。取一帧后清空记录 */
const takeArcs = (): unknown[][] => {
  const out = ctx.calls.filter((c) => c.op === 'arc').map((c) => c.args.slice(0, 3));
  ctx.calls.length = 0;
  return out;
};

beforeEach(() => {
  graphData.mockClear();
  // 每次都回一份**新对象**的数据(同一引用会被 React 挡掉,重载就不重建 plan)
  graphData.mockImplementation(async () => ({ nodes: NODES.map((n) => ({ ...n })), edges: [] }));
  queryNotes.mockClear();
  queryNotes.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }) as Note));
  ctx = makeCanvasCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  restoreMetrics = metrics();
});

afterEach(() => {
  restoreMetrics();
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('GraphView:数据版本变化', () => {
  it('版本不变不重取;版本变了重取一次', async () => {
    await mount(3);
    expect(graphData).toHaveBeenCalledTimes(1); // 进视图拉一次
    await mount(3);
    expect(graphData).toHaveBeenCalledTimes(1); // 同一版本再渲染不打库
    await mount(4);
    await flush();
    expect(graphData).toHaveBeenCalledTimes(2);
  });

  it('重载只换数据:缩放档、选中、展开都保留', async () => {
    await mount(0);
    await fire('click', at(1)); // 选中
    await fire('dblclick', at(1)); // 展开
    await flush();
    ctx.calls.length = 0; // 只留缩放后那一帧
    await key('+'); // 缩放一次:相机不再等于 fitToView
    const zoomed = takeArcs();
    expect(host.querySelector('[data-testid="graph-info-bar"]')).not.toBeNull();
    expect(zoomed.some((a) => a[2] === 3)).toBe(true); // 半径 3 = 展开的笔记小圆

    await mount(1); // 版本变化 -> 重取
    await flush();
    expect(graphData).toHaveBeenCalledTimes(2);
    // 相机没被重新 fit(点位仍与缩放后逐项相同),选中与展开也没丢
    expect(takeArcs()).toEqual(zoomed);
    expect(host.querySelector('[data-testid="graph-info-bar"]')).not.toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * GraphView 的展开笔记接线面(G2 Task 6):双击展开 -> 取数回包 -> plan 重建 -> 画出小圆与 `+N`;
 * 点小圆 = 带着该标签回信息流,且不能同时被当成画布点击(否则选中先被清掉、信息条当场消失)。
 *
 * 节点屏幕位置用视图同一套纯函数现算(`visibleGraph` -> `radialLayout` -> `fitToView` -> `screenOf`),
 * 小圆位置另按 `noteFan` 的算法摆(正上方起顺时针,半径 = 标签半径 + 14),免得把算式抄成第二份。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { Note } from '../../shared/types';
import { makeCanvasCtx, type CanvasCtxStub } from './canvas-test-kit';
import { fitToView, screenOf } from './graph-camera';
import { radiusOf } from './graph-draw-plan';
import { collapseRootsOf, visibleGraph } from './graph-view-model';
import { NOTE_LIMIT, NOTE_R } from './graph-notes';
import { radialLayout } from './radial';
import { normalizeTemplate } from '../settings/time-tag-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 节点 1 含 414 条:展开应画 20 个圆 + `+394`;节点 2 的半径与笔记小圆不同(3.25 ≠ 3) */
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
/** 视图那条流水线的镜像:模板为 null -> 默认模板 -> 折叠根不在夹具里 -> 两个节点都可见 */
const VISIBLE = visibleGraph(DATA, { collapsedRoots: collapseRootsOf(normalizeTemplate(null)) }).nodes;
const LAYOUT = radialLayout(VISIBLE, { layerGap: 90 });
const CAM = fitToView([...LAYOUT.values()], W, H);

/** 展开笔记的扇形半径(与 use-expanded-notes 同一口径:标签半径 + 14 的屏幕像素) */
const FAN_R = radiusOf(414) + 14;

/** 世界坐标 -> 事件用的 client 坐标(jsdom 里容器原点为 0,画布坐标就是 client 坐标) */
const client = (p: { x: number; y: number }): { clientX: number; clientY: number } => ({
  clientX: p.x,
  clientY: p.y,
});

/** 节点在画布上的位置 */
const at = (id: number): { clientX: number; clientY: number } => client(screenOf(LAYOUT.get(id)!, CAM));

/** 第 i 个笔记小圆的 client 位置(noteFan 从正上方起顺时针铺;屏幕口径:标签点的屏幕位置 + 屏幕半径) */
const dotAt = (id: number, i: number): { clientX: number; clientY: number } => {
  const c = screenOf(LAYOUT.get(id)!, CAM);
  const a = (Math.PI * 2 * i) / NOTE_LIMIT - Math.PI / 2;
  return client({ x: c.x + Math.cos(a) * FAN_R, y: c.y + Math.sin(a) * FAN_R });
};

let root: Root;
let host: HTMLDivElement;
let onFilter: ReturnType<typeof vi.fn>;
let getContext: MockInstance<HTMLCanvasElement['getContext']>;
let ctx: CanvasCtxStub;

/** 挂载 + flush(数据与设置的第一次回包) */
const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(GraphView, { onExit: () => {}, onFilterToStream: onFilter, dataVersion: 0 }));
  });
  await act(async () => {
    await Promise.resolve();
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

beforeEach(() => {
  graphData.mockClear();
  graphData.mockResolvedValue(DATA);
  queryNotes.mockClear();
  // 后端页大小 50:够覆盖 20 个圆
  queryNotes.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }) as Note));
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

/** 半径等于笔记小圆半径的那些 arc —— 画布上只有笔记小圆用 NOTE_R */
const noteArcs = (): unknown[][] => ctx.calls.filter((c) => c.op === 'arc' && c.args[2] === NOTE_R).map((c) => c.args);

const texts = (): unknown[] => ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);

describe('GraphView:展开笔记', () => {
  it('双击展开:取数回包后画出 20 个笔记小圆 + +394', async () => {
    const restore = metrics();
    try {
      await mount();
      expect(texts()).not.toContain('+394'); // 展开之前一个圆都没有
      expect(noteArcs()).toHaveLength(0);
      const drawn = getContext.mock.calls.length;
      await fire('dblclick', at(1));
      await flush();
      expect(queryNotes).toHaveBeenCalledTimes(1);
      // plan 换对象才会重绘:喂给 drawPlan 的 expanded 少一环,这里就一次重绘都没有
      expect(getContext.mock.calls.length).toBeGreaterThan(drawn);
      expect(noteArcs()).toHaveLength(NOTE_LIMIT);
      expect(texts()).toContain('+394');
      // 小圆落在标签正上方那一圈上(屏幕口径算出来的位置,与视图口径一致)
      expect(noteArcs()[0].slice(0, 2)).toEqual([dotAt(1, 0).clientX, dotAt(1, 0).clientY]);
    } finally {
      restore();
    }
  });

  it('点小圆 = 带着该标签回信息流,且不算画布点击(选中与信息条都还在)', async () => {
    const restore = metrics();
    try {
      await mount();
      await fire('click', at(1)); // 选中
      await fire('dblclick', at(1)); // 展开
      await flush();
      expect(host.querySelector('[data-testid="graph-info-bar"]')).not.toBeNull();
      await fire('click', dotAt(1, 3));
      expect(onFilter).toHaveBeenCalledWith('甲');
      // 点小圆不能顺带走画布点击:那会先把选中清掉,信息条当场消失
      expect(host.querySelector('[data-testid="graph-info-bar"]')).not.toBeNull();
    } finally {
      restore();
    }
  });
});

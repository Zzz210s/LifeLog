// @vitest-environment jsdom
/**
 * 展开条目之间的 link 边接线(L4):后端给的 `kind:'link'` 边穿过过滤器与 plan,最终落到画布上。
 *
 * 这一条专门盯**两级判据**:
 * ① 展开前一条线都不画(link 的两端是笔记,没展开就没有落点);
 * ② 展开后只画两端都在扇形里的那一条 —— 另一半 (1, 999) 的 999 没被展开,不能画。
 * 端点与笔记小圆比的是**画布真实调用**(moveTo/lineTo 对 arc),不重算扇形位置。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { Note } from '../../shared/types';
import { makeCanvasCtx, type CanvasCtxStub } from './canvas-test-kit';
import { fitToView, screenOf } from './graph-camera';
import { NOTE_R } from './graph-notes';
import { radialLayout } from './radial';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 只有一个标签、两个条目、两条 link 边(其中一条的另一端 999 不在展开的笔记里) */
const NODES = [{ id: 1, path: '甲', depth: 1, parent: null, notes: 2, selfCount: 2, sortOrder: 0 }];
const DATA = {
  nodes: NODES,
  edges: [
    { a: 1, b: 2, kind: 'link' as const, weight: 1 },
    { a: 1, b: 999, kind: 'link' as const, weight: 1 },
  ],
};

const { graphData, queryNotes } = vi.hoisted(() => ({
  graphData: vi.fn(async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => ({ nodes: [], edges: [] })),
  queryNotes: vi.fn(async (): Promise<Note[]> => []),
}));
vi.mock('../../shared/api', () => ({
  api: {
    graphData,
    graphLinkDegrees: vi.fn(async () => ({ outbound: 0, backlinks: 0 })),
    queryNotes,
    getSetting: vi.fn(async () => null),
    setSetting: vi.fn(async () => undefined),
  },
}));

import { GraphView } from './GraphView';

const W = 400;
const H = 300;
const LAYOUT = radialLayout(NODES, { layerGap: 90 });
const CAM = fitToView([...LAYOUT.values()], W, H);
const at = (id: number): { clientX: number; clientY: number } => {
  const s = screenOf(LAYOUT.get(id)!, CAM);
  return { clientX: s.x, clientY: s.y };
};

let root: Root;
let host: HTMLDivElement;
let ctx: CanvasCtxStub;
let restore: () => void;

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(GraphView, { onExit: () => {}, onFilterToStream: () => {}, dataVersion: 0 }));
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const expand = async (): Promise<void> => {
  await act(async () => {
    host
      .querySelector('[data-testid="graph-view"]')!
      .dispatchEvent(new MouseEvent('dblclick', { ...at(1), bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
};

/** 笔记小圆的画布坐标(半径恰好 NOTE_R 的弧:标签点半径 2.5~9,选中环 = 半径 + 3) */
const dotAt = (i: number): number[] => {
  const arcs = ctx.calls.filter((c) => c.op === 'arc' && c.args[2] === NOTE_R);
  return arcs[i].args.slice(0, 2) as number[];
};
const segs = (): number[][] => {
  const moveTo = ctx.moveTo as MockInstance;
  const lineTo = ctx.lineTo as MockInstance;
  return moveTo.mock.calls.map((m, i) => [...(m as number[]), ...(lineTo.mock.calls[i] as number[])]);
};

beforeEach(() => {
  graphData.mockReset();
  graphData.mockResolvedValue(DATA);
  queryNotes.mockReset();
  queryNotes.mockResolvedValue([{ id: 1 } as Note, { id: 2 } as Note]);
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { get: () => W, configurable: true });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { get: () => H, configurable: true });
  restore = () => {
    delete (HTMLDivElement.prototype as { clientWidth?: unknown }).clientWidth;
    delete (HTMLDivElement.prototype as { clientHeight?: unknown }).clientHeight;
  };
  document.documentElement.style.setProperty('--color-accent', 'rgb(44, 44, 44)');
  ctx = makeCanvasCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.style.removeProperty('--color-accent');
  vi.restoreAllMocks();
  restore();
});

describe('GraphView:展开条目之间的 link 边', () => {
  it('展开前不画线;展开后只画两端都在扇形里的那一条,端点就是两个笔记小圆', async () => {
    await mount();
    expect(segs()).toEqual([]); // 这份图数据里只有 link 边:一个 moveTo 都不该有

    await expand();
    expect(ctx.calls.filter((c) => c.op === 'arc' && c.args[2] === NOTE_R)).toHaveLength(2);
    // 两条 link 边里只有 (1,2) 两端都在展开的笔记里 -> 一条段,端点是那两个小圆
    expect(segs()).toHaveLength(1);
    expect(segs()[0].slice(0, 2)).toEqual(dotAt(0));
    expect(segs()[0].slice(2)).toEqual(dotAt(1));
    // 颜色走主题令牌(共现 -> 父子 -> 链接 -> 笔记小圆:第 3 笔是链接层),线宽 1.5
    expect(ctx.writes.strokeStyle[2]).toBe('rgb(44, 44, 44)');
    expect(ctx.calls.filter((c) => c.op === 'stroke').map((c) => c.lineWidth)).toEqual([1.5, 1, 1]);
  });
});

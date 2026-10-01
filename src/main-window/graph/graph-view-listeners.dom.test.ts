// @vitest-environment jsdom
/**
 * GraphView 的监听与退出口径(2026-09-30 终审修复轮):
 * - `Esc` / 双击空白:有选中标签就把该标签带回信息流(设计 §5),没有选中才原样退出;
 *   双击命中节点仍是展开(两种双击不是一回事)
 * - 画布滚轮:监听必须 `passive: false`(否则 `preventDefault` 无效、页面跟着滚),
 *   且缩放锚点吃的是**画布坐标** —— 容器有视口原点偏置(左手侧栏、上头顶栏)时要减掉它,
 *   不换算就整体偏一个容器原点(真机实测锚点偏 295px)
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCanvasCtx, type CanvasCtxStub } from './canvas-test-kit';
import { fitToView, screenOf, zoomAt } from './graph-camera';
import { collapseRootsOf, visibleGraph } from './graph-view-model';
import { radialLayout } from './radial';
import { ZOOM_STEP } from './use-graph-camera';
import { normalizeTemplate } from '../settings/time-tag-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NODES = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 4, selfCount: 4, sortOrder: 0 },
  { id: 2, path: '甲/一', depth: 2, parent: 1, notes: 4, selfCount: 2, sortOrder: 0 },
  { id: 3, path: '丙', depth: 1, parent: null, notes: 4, selfCount: 4, sortOrder: 0 },
];
const DATA = { nodes: NODES, edges: [{ a: 1, b: 2, kind: 'tree' as const, weight: 1 }] };
const W = 400;
const H = 300;
/** 视口裁剪的余量(与 `cullVisible` 的默认 margin 同口径) */
const CULL_MARGIN = 40;

const { graphData } = vi.hoisted(() => ({
  graphData: vi.fn(async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => ({ nodes: [], edges: [] })),
}));
// getSetting 恒 null:模板取默认值(根名不在夹具里 -> 一根都不折),graph_positions 也没有记忆
vi.mock('../../shared/api', () => ({
  api: {
    graphData,
    getSetting: vi.fn(async () => null),
    setSetting: vi.fn(async () => undefined),
    queryNotes: vi.fn(async () => []), // 双击命中 = 展开,展开后要去拉笔记
  },
}));

import { GraphView } from './GraphView';

/** 视图那条流水线的镜像:节点都可见 -> 布局 -> 首次适配相机(据点就是画布坐标) */
const LAYOUT = radialLayout(visibleGraph(DATA, { collapsedRoots: collapseRootsOf(normalizeTemplate(null)) }).nodes, {
  layerGap: 90,
});
const FIT = fitToView([...LAYOUT.values()], W, H);

let root: Root;
let host: HTMLDivElement;
let exit: ReturnType<typeof vi.fn>;
let filter: ReturnType<typeof vi.fn>;
let ctx: CanvasCtxStub;

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(GraphView, { dataVersion: 0, onExit: exit, onFilterToStream: filter }));
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

const escape = async (): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
};

/** 滚轮:给的是 client 坐标(调用方自己加容器原点) */
const wheel = async (clientX: number, clientY: number): Promise<WheelEvent> => {
  const e = new WheelEvent('wheel', { deltaY: -100, clientX, clientY, bubbles: true, cancelable: true });
  await act(async () => {
    el().dispatchEvent(e);
  });
  return e;
};

/** 已画出的点圆心(画布坐标;dpr=1,`setTransform` 是恒等) */
const dots = (): { x: number; y: number }[] =>
  ctx.calls.filter((c) => c.op === 'arc').map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));

const near = (list: readonly { x: number; y: number }[], p: { x: number; y: number }): boolean =>
  list.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6);

beforeEach(() => {
  graphData.mockClear();
  graphData.mockResolvedValue(DATA);
  exit = vi.fn();
  filter = vi.fn();
  ctx = makeCanvasCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
  // 容器实测尺寸的可变读数(jsdom 没有布局引擎,只能在原型上挂 getter;afterEach 摘掉)
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { get: () => W, configurable: true });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { get: () => H, configurable: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  delete (HTMLDivElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLDivElement.prototype as { clientHeight?: unknown }).clientHeight;
});

describe('GraphView:Esc / 双击空白的退出口径', () => {
  it('有选中标签时按 Esc:把该标签带回信息流,不原样退出', async () => {
    await mount();
    // 用图内搜索选中一个节点:不依赖坐标,顺带走一遍「搜到 -> 选中」
    const input = host.querySelector<HTMLInputElement>('[data-testid="graph-search-input"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, '丙');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(host.querySelector('[data-testid="graph-info-bar"]')?.textContent).toContain('丙');
    await escape();
    expect(filter).toHaveBeenCalledWith('丙');
    expect(exit).not.toHaveBeenCalled();
  });

  it('没有选中时按 Esc:原样退出', async () => {
    await mount();
    await escape();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(filter).not.toHaveBeenCalled();
  });

  it('双击空白 -> 回信息流;双击命中节点 -> 展开(不退出)', async () => {
    await mount();
    const at = screenOf(LAYOUT.get(1)!, FIT);
    await fire('dblclick', { clientX: at.x, clientY: at.y });
    expect(exit).not.toHaveBeenCalled(); // 命中的双击是展开
    await fire('dblclick', { clientX: 4, clientY: 4 }); // 空白处
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('GraphView:滚轮缩放的锚点与被动层', () => {
  it('以光标(减掉容器原点后的画布坐标)为锚:容器不在视口原点也锚得住', async () => {
    await mount();
    // 容器真实位置:左边侧栏、上边顶栏(真机读数 292.5 / 44)
    const rect = { left: 292.5, top: 44 } as DOMRect;
    vi.spyOn(el(), 'getBoundingClientRect').mockReturnValue(rect);
    // 前置:首次适配已跑过(点落在 FIT 的落点上),否则下面的期望值无从谈起
    expect(near(dots(), screenOf(LAYOUT.get(1)!, FIT))).toBe(true);
    ctx.calls.length = 0; // 只看这次滚轮引起的重绘
    const anchor = { x: W / 2, y: H / 2 };
    await wheel(anchor.x + rect.left, anchor.y + rect.top);
    const after = dots();
    // 视口内(含裁剪余量)的每个点都必须落在「以画布中心为锚放一格」的期望位置:
    // 忘了减容器原点时锚点会跑到 client(592.5,194),全部落点随之偏出几十像素
    const cam = zoomAt(FIT, ZOOM_STEP, anchor);
    const expected = [...LAYOUT.values()]
      .map((p) => screenOf(p, cam))
      .filter((s) => s.x >= -CULL_MARGIN && s.x <= W + CULL_MARGIN && s.y >= -CULL_MARGIN && s.y <= H + CULL_MARGIN);
    expect(after.length).toBe(expected.length);
    for (const s of expected) expect(near(after, s)).toBe(true);
  });

  it('画布 wheel 监听不是被动的:preventDefault 真的拦下页面滚动', async () => {
    await mount();
    // 被动监听里 preventDefault 是空操作 -> 这条红的唯一原因就是有人把监听改成被动
    expect((await wheel(100, 100)).defaultPrevented).toBe(true);
  });
});

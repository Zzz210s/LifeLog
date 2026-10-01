// @vitest-environment jsdom
/**
 * 相机首次适配要等折叠根落定(G3 修复轮):`collapsedRoots` 是异步读设置,而 `useAutoFit` 只适配一次 ——
 * 不等它就会拿「没折叠」的全量落点算 fit(真机:退出再进图 k=0.751/tx=411/ty=304.2;正确 k=0.949/tx=547.1/ty=221.9)。
 * 这里用**受控的**模板回包(不是立即 resolve)把竞态摆出来:放行前相机一点没动,
 * 放行后必须按**折叠后**的点集适配 —— 两个候选点集的 fit 不同,断言用的必须是后者。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { fitToView } from './graph-camera';
import { radialLayout, type Point } from './radial';
import { makeCanvasCtx, type CanvasCtxStub } from './canvas-test-kit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const W = 400;
const H = 300;

const { graphData, getSetting, gate } = vi.hoisted(() => {
  const g: { release: (v: string | null) => void } = { release: () => {} };
  return {
    gate: g,
    graphData: vi.fn(async () => ({
      nodes: [
        { id: 1, path: '时间', depth: 1, parent: null, notes: 1177, selfCount: 137, sortOrder: 0 },
        { id: 2, path: '时间/日期', depth: 2, parent: 1, notes: 1040, selfCount: 1040, sortOrder: 0 },
        { id: 3, path: '地点', depth: 1, parent: null, notes: 779, selfCount: 779, sortOrder: 0 },
      ],
      edges: [{ a: 1, b: 2, kind: 'tree' as const, weight: 1 }],
    })),
    // time_tag_template 的回包由测试放行;别的键(位置记忆)立即回 null
    getSetting: vi.fn(
      (key: string): Promise<string | null> =>
        key === 'time_tag_template'
          ? new Promise<string | null>((res) => {
              g.release = res;
            })
          : Promise.resolve(null),
    ),
  };
});
vi.mock('../../shared/api', () => ({
  api: { graphData, graphLinkDegrees: vi.fn(async () => ({ outbound: 0, backlinks: 0 })), getSetting, setSetting: vi.fn(async () => undefined) },
}));

import { GraphView } from './GraphView';

const node = (id: number, path: string, parent: number | null, depth: number, notes: number): GraphNode => ({
  id, path, depth, parent, notes, selfCount: notes, sortOrder: 0,
});
const N1 = node(1, '时间', null, 1, 1177);
const N2 = node(2, '时间/日期', 1, 2, 1040);
const N3 = node(3, '地点', null, 1, 779);
const ALL3 = [N1, N2, N3];
/** 折叠「时间」后的可见集:该轴只留根(时间/日期 被挡掉) */
const FOLDED = [N1, N3];

const layoutOf = (nodes: readonly GraphNode[]): Map<number, Point> => radialLayout(nodes, { layerGap: 90 });

/** 从画布上两个点圆反推相机:两点的 y 不同就够解出 k,再回代拿 tx/ty */
const camFrom = (a: Point, b: Point, arcs: number[][]): { k: number; tx: number; ty: number } => {
  const k = (arcs[0][1] - arcs[1][1]) / (a.y - b.y);
  return { k, tx: arcs[0][0] - a.x * k, ty: arcs[0][1] - a.y * k };
};

let root: Root;
let host: HTMLDivElement;
let ctx: CanvasCtxStub;

const lastArcs = (n: number): number[][] =>
  ctx.calls.filter((c) => c.op === 'arc').slice(-n).map((c) => [c.args[0], c.args[1]] as number[]);

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(GraphView, { dataVersion: 0, onExit: () => {}, onFilterToStream: () => {} }));
  });
};

beforeEach(() => {
  gate.release = () => {};
  graphData.mockClear();
  getSetting.mockClear();
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { get: () => W, configurable: true });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { get: () => H, configurable: true });
  ctx = makeCanvasCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (HTMLDivElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLDivElement.prototype as { clientHeight?: unknown }).clientHeight;
  vi.restoreAllMocks();
});

describe('GraphView:首次适配等折叠根就绪', () => {
  it('折叠根放行前不动相机;放行后按折叠后的点集适配(k/tx/ty 用的是后者)', async () => {
    await mount();

    // 放行前:模板回包还挂着 -> 折叠根是 null -> 还没适配。相机还是初始值(k=1、无平移),
    // 屏上那两个点就是世界坐标本身(未折叠布局里「时间/日期」的 x≈-45 落在视口外被裁掉了)
    const layout3 = layoutOf(ALL3);
    const raw3 = ALL3.map((n) => layout3.get(n.id)!);
    const fitUnfolded = fitToView(raw3, W, H); // 未折叠点集的 fit:不该被用
    const before = lastArcs(2);
    expect(before).toHaveLength(2);
    expect(before[0][0]).toBeCloseTo(layout3.get(1)!.x, 6);
    expect(before[0][1]).toBeCloseTo(layout3.get(1)!.y, 6);
    expect(before[1][0]).toBeCloseTo(layout3.get(3)!.x, 6);
    expect(before[1][1]).toBeCloseTo(layout3.get(3)!.y, 6);

    // 放行:读到模板 -> 折叠「时间」-> 可见点从 3 个变 2 个 -> 这时才适配
    await act(async () => {
      gate.release('时间/{y}/{m}/{d}');
      await Promise.resolve();
    });
    const layoutF = layoutOf(FOLDED);
    expect(lastArcs(2)).toHaveLength(2);
    const after = camFrom(layoutF.get(1)!, layoutF.get(3)!, lastArcs(2));
    const want = fitToView([...layoutF.values()], W, H); // 折叠点集的 fit
    expect(after.k).toBeCloseTo(want.k, 6);
    expect(after.tx).toBeCloseTo(want.tx, 6);
    expect(after.ty).toBeCloseTo(want.ty, 6);

    // 两个候选相机确实不同 —— 上面三条才算证明了「用的是后者」
    expect(fitUnfolded.k).not.toBeCloseTo(want.k, 3);
  });
});

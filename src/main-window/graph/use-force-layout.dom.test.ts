// @vitest-environment jsdom
/**
 * 「整理布局」的 rAF 分块调度证据:逐帧回调、收敛即停且停手后不再 onFrame、锚点原样、
 * 已在跑时不叠帧、stop() 与卸载立即停、总时长超 1.5s 也停。
 * 一帧的预算与出口在 force-frame.test.ts;一步的力在 force-layout.test.ts;
 * 视图侧接线(按钮文案、"整理不写库")在 graph-view-arrange.dom.test.ts。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { GraphEdge } from '../../shared/types';
import type { Point } from './radial';
import { useForceLayout, type ForceLayoutApi } from './use-force-layout';

/** 三点夹具:1 在原点、2 与 3 各距 1(斥力会把它们推开) */
const P: Map<number, Point> = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 1, y: 0 }],
  [3, { x: 0, y: 1 }],
]);

let frames: FrameRequestCallback[] = [];
let api: ForceLayoutApi | null = null;
let seen: Map<number, Point>[] = [];
let props: { points: Map<number, Point>; edges: GraphEdge[]; anchors: Set<number> };
let root: Root;
let host: HTMLDivElement;

function Harness(): null {
  api = useForceLayout({
    points: props.points,
    edges: props.edges,
    anchors: props.anchors,
    onFrame: (p) => {
      seen.push(p);
    },
  });
  return null;
}

/** 跑一帧(消费当前挂着的所有 raf 回调) */
const drive = (): void => {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(0);
};

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness));
  });
};

/** 一直跑到停手(或驱动上限),返回驱动次数 */
const runToRest = async (max = 500): Promise<number> => {
  let n = 0;
  while (frames.length > 0 && n < max) {
    await act(async () => {
      drive();
    });
    n += 1;
  }
  return n;
};

beforeEach(() => {
  vi.restoreAllMocks();
  frames = [];
  seen = [];
  api = null;
  props = { points: P, edges: [], anchors: new Set() };
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', (): void => {
    frames = [];
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useForceLayout:rAF 分块', () => {
  it('收敛即停:逐帧回调、坐标确实变了,停手后不再回调', async () => {
    await mount();
    await act(async () => {
      api!.start();
    });
    expect(api!.running).toBe(true);
    expect(frames.length).toBe(1); // 只挂了一帧,不叠

    const driven = await runToRest();
    expect(driven).toBeGreaterThan(1);
    expect(api!.running).toBe(false);
    expect(frames.length).toBe(0);
    expect(seen.length).toBe(driven); // 每帧一次回调
    const last = seen[seen.length - 1];
    expect(last).not.toBe(P); // 换成了新坐标表
    expect(last.get(2)).not.toEqual(P.get(2));
    expect(P.get(2)).toEqual({ x: 1, y: 0 }); // 起点表没被改写

    const n = seen.length;
    await act(async () => {
      drive();
    });
    expect(seen.length).toBe(n);
  });

  it('锚点(拖过的节点)在整理结果里坐标原样', async () => {
    props = {
      points: new Map([
        [1, { x: 0, y: 0 }],
        [2, { x: 200, y: 0 }],
      ]),
      edges: [],
      anchors: new Set([1]),
    };
    await mount();
    await act(async () => {
      api!.start();
    });
    await runToRest();
    const last = seen[seen.length - 1];
    expect(last.get(1)).toEqual({ x: 0, y: 0 });
    expect(last.get(2)).not.toEqual({ x: 200, y: 0 });
  });

  it('已在跑时再 start 不叠帧;stop() 立即停且不再回调', async () => {
    await mount();
    await act(async () => {
      api!.start();
      api!.start();
    });
    expect(frames.length).toBe(1);
    await act(async () => {
      api!.stop();
    });
    expect(api!.running).toBe(false);
    expect(frames.length).toBe(0);
    const n = seen.length;
    await act(async () => {
      drive();
    });
    expect(seen.length).toBe(n);
  });

  it('卸载后待跑的帧被撤掉,不再回调', async () => {
    await mount();
    await act(async () => {
      api!.start();
    });
    expect(frames.length).toBe(1);
    act(() => root.unmount());
    expect(frames.length).toBe(0);
    const n = seen.length;
    drive();
    expect(seen.length).toBe(n);
    root = createRoot(document.createElement('div')); // afterEach 会再 unmount,换个新根
  });

  it('总时长超过 1.5s 就停手:还没收敛也必须停', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000)); // 每帧 +1s 级
    await mount();
    await act(async () => {
      api!.start();
    });
    await runToRest(20);
    expect(api!.running).toBe(false);
    expect(frames.length).toBe(0);
    expect(seen.length).toBeLessThan(5); // 靠总时长停的,不是靠收敛(收敛要 ~22 帧)
    expect(seen[seen.length - 1].get(2)).not.toEqual(P.get(2));
  });
});

// @vitest-environment jsdom
/**
 * 「重置视图」与 `0` 是**同一个出口**(G3 Task 6,`useGraphStage` 的 `resetView`):
 * 作废整理结果(回径向布局)+ 相机复位到适配视图。T4 遗留"整理后的坐标只在内存里、
 * 回径向唯一的路是退出视图"到此收掉:一键可达。
 *
 * 还钉住那条容易写坏的地方:复位信号**只在真的按了按钮 / `0` 时**生效 ——
 * 只盯 `reset` 的回调身份(尺寸或落点一变它就换引用)会让拖节点、整理每一帧都把用户的缩放冲掉。
 * 力导向的 rAF 在用例里手动驱动(与 graph-view-arrange 同一套替身)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { graphData, getSetting, setSetting } = vi.hoisted(() => ({
  graphData: vi.fn(async () => ({
    nodes: [
      { id: 1, path: '时间', depth: 1, parent: null, notes: 1177, selfCount: 137, sortOrder: 0 },
      { id: 2, path: '时间/日期', depth: 2, parent: 1, notes: 1040, selfCount: 1040, sortOrder: 0 },
      { id: 3, path: '地点', depth: 1, parent: null, notes: 779, selfCount: 779, sortOrder: 0 },
    ],
    edges: [{ a: 1, b: 2, kind: 'tree' as const, weight: 1 }],
  })),
  getSetting: vi.fn(async (key: string): Promise<string | null> =>
    key === 'time_tag_template' ? '时间/{y}/{m}/{d}' : null,
  ),
  setSetting: vi.fn(async () => undefined),
}));
vi.mock('../../shared/api', () => ({ api: { graphData, getSetting, setSetting } }));

import { GraphView } from './GraphView';
import { makeCanvasCtx, type CanvasCtxStub } from './canvas-test-kit';

let frames: FrameRequestCallback[] = [];
let root: Root;
let host: HTMLDivElement;
let ctx: CanvasCtxStub;

const drive = (): void => {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(0);
};

/** 一直跑到停手(或驱动上限) */
const runToRest = async (max = 400): Promise<number> => {
  let n = 0;
  while (frames.length > 0 && n < max) {
    await act(async () => {
      drive();
    });
    n += 1;
  }
  return n;
};

const arrangeButton = (): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find((b) => b.textContent!.includes('整理')) as HTMLButtonElement;

/** 最近一次绘制的点坐标(arc 的前两个参数),按节点顺序:[0] = `时间`, [1] = `地点`
 *  (`时间/日期` 被折叠掉,不进布局) */
const lastArcs = (n = 2): number[][] =>
  ctx.calls
    .filter((c) => c.op === 'arc')
    .slice(-n)
    .map((c) => [c.args[0], c.args[1]] as number[]);

beforeEach(() => {
  vi.restoreAllMocks();
  graphData.mockClear();
  setSetting.mockClear();
  getSetting.mockClear();
  frames = [];
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', (): void => {
    frames = [];
  });
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { get: () => 400, configurable: true });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { get: () => 300, configurable: true });
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(GraphView, { dataVersion: 0, onExit: () => {}, onFilterToStream: () => {} }));
  });
};

const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    el.click();
  });
};

const key = async (k: string): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  });
};

const fire = async (type: string, point: { clientX: number; clientY: number }): Promise<void> => {
  await act(async () => {
    const view = host.querySelector('[data-testid="graph-view"]') as HTMLElement;
    view.dispatchEvent(new MouseEvent(type, { ...point, bubbles: true }));
  });
};

const same = (a: number[], b: number[]): boolean =>
  Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;

describe('GraphView:重置视图', () => {
  it('整理后按 `0`:坐标回到径向,相机也重新适配(两件事一起)', async () => {
    await mount();
    const radial = lastArcs();
    expect(radial).toHaveLength(2);
    await click(arrangeButton());
    await runToRest();
    expect(lastArcs()).not.toEqual(radial); // 整理确实把点挪走了
    await key('-'); // 缩一格:相机离开适配值(夹具的适配倍数已顶到 MAX_K,再放大没有效果)
    expect(lastArcs()).not.toEqual(radial);
    await key('0');
    // 逐点相等 = 布局回到径向 + 相机回到适配值;只做其中一半都到不了这里
    expect(lastArcs()).toEqual(radial);
  });

  it('点「重置视图」按钮与 `0` 同效(整理结果作废、相机重新适配)', async () => {
    await mount();
    const radial = lastArcs();
    await click(arrangeButton());
    await runToRest();
    await key('-');
    const resetButton = [...host.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('重置视图'),
    ) as HTMLButtonElement;
    await click(resetButton);
    expect(lastArcs()).toEqual(radial);
  });

  it('拖节点换掉落点(复位回调因此换引用)不会把相机拉回适配视图', async () => {
    await mount();
    const radial = lastArcs();
    await key('-'); // 先离开适配值:相机若被误复位,这里立刻看得出来
    const zoomed = lastArcs();
    expect(zoomed).not.toEqual(radial);
    // 被拖的点 = 节点顺序里的第 0 个(节点 1);屏幕位移 (30,20)
    const from = { clientX: zoomed[0][0], clientY: zoomed[0][1] };
    await fire('pointerdown', from);
    await fire('pointermove', { clientX: from.clientX + 30, clientY: from.clientY + 20 });
    await fire('pointerup', from);
    const after = lastArcs();
    expect(after[0][0]).toBeCloseTo(from.clientX + 30, 5);
    expect(after[0][1]).toBeCloseTo(from.clientY + 20, 5);
    // 别的点原地不动 = 相机没被动过(复位信号只在按钮 / `0` 时生效)
    expect(same(after[1], zoomed[1])).toBe(true);
  });
});

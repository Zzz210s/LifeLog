// @vitest-environment jsdom
/**
 * 「整理布局」的视图侧接线(按钮 -> 力导向 -> 画布):
 * - 跑动期间按钮禁用 + 文案「整理中…」,停手后恢复
 * - 画布上的点确实挪了(对比 arc 调用的坐标)
 * - **整理不写库**:`setSetting` 从头到尾没被调用过(只有拖节点才写 `graph_positions`)
 * 力导向本身在 force-layout / force-frame / use-force-layout 三个用例文件里。
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

/** 画布上的点坐标(arc 调用的前两个参数),取最后 n 个 = 最近一次绘制的点 */
const lastArcs = (n: number): number[][] =>
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

describe('GraphView:整理布局', () => {
  it('初始可点、文案「整理布局」;点后跑动期间禁用并显示「整理中…」', async () => {
    await mount();
    const btn = arrangeButton();
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    await click(btn);
    const running = arrangeButton();
    expect(running.disabled).toBe(true); // running 时禁用
    expect(running.textContent).toContain('整理中…');
    await runToRest();
    expect(arrangeButton().disabled).toBe(false);
    expect(arrangeButton().textContent).toContain('整理布局');
  });

  it('画布上的点确实被挪走了(整理结果进了绘制)', async () => {
    await mount();
    const before = lastArcs(2);
    expect(before.length).toBe(2);
    await click(arrangeButton());
    const driven = await runToRest();
    expect(driven).toBeGreaterThan(0);
    expect(frames.length).toBe(0);
    const after = lastArcs(2);
    expect(after).not.toEqual(before);
  });

  it('整理不写库:setSetting 一次都没被调用(只有拖节点才写 graph_positions)', async () => {
    await mount();
    await click(arrangeButton());
    await runToRest();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('被拖过的节点(位置记忆里有)当锚点:整理后它原地不动,只有别的点在挪', async () => {
    getSetting.mockImplementation(async (key: string): Promise<string | null> => {
      if (key === 'time_tag_template') return '时间/{y}/{m}/{d}';
      if (key === 'graph_positions') return '{"3":{"x":100,"y":0}}'; // 3 = 地点
      return null;
    });
    await mount();
    const before = lastArcs(2);
    await click(arrangeButton());
    await runToRest();
    const after = lastArcs(2);
    const kept = after.filter((a) => before.some((b) => b[0] === a[0] && b[1] === a[1]));
    expect(kept.length).toBe(1); // 只有锚点原地不动
    expect(after).not.toEqual(before);
  });

  it('停手后再点一次仍能跑(状态复位干净)', async () => {
    await mount();
    await click(arrangeButton());
    await runToRest();
    const framesAfterFirst = frames.length;
    expect(framesAfterFirst).toBe(0);
    await click(arrangeButton());
    expect(frames.length).toBe(1); // 又挂上一帧
    await runToRest();
    expect(arrangeButton().disabled).toBe(false);
  });
});

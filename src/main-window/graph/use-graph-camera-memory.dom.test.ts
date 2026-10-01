// @vitest-environment jsdom
/**
 * 相机的位置记忆(只读叠加 + 写回):库里记过的节点覆盖布局坐标、坏值一律忽略、
 * `commitPositions` 先本地生效(不等库的回包)再"读旧值 -> 合并 -> 修剪 -> 写回"。
 * 纯函数(解析/修剪/叠加)的用例在 graph-positions.test.ts;这里只盯相机这一层的接线。
 * 与滚轮/平移/复位分在两个文件是守 200 行红线(本文件不需要原点与事件发送)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(async (): Promise<string | null> => null),
  setSetting: vi.fn(async () => undefined),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting } }));

import type { Point } from './radial';
import { useGraphCamera, type GraphCameraApi } from './use-graph-camera';

const W = 400;
const H = 300;
/** 布局结果(夹具):两个点,记忆位置只覆盖第二个 */
const layout: Map<number, Point> = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 100, y: 0 }],
]);

let api: GraphCameraApi | null = null;
let root: Root;
let host: HTMLDivElement;
let ids = new Set<number>([1, 2]);

function Harness(): null {
  api = useGraphCamera({ width: W, height: H, points: layout, validIds: ids });
  return null;
}

/** 挂载并把位置记忆的读取 flush 掉 */
const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness));
  });
  await act(async () => {
    await Promise.resolve();
  });
};

/** 把写回链(读旧值 -> 写回)的微任务跑完 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** 写回调用:[键, 原文] */
const lastWrite = (): [string, string] => setSetting.mock.calls[0] as unknown as [string, string];

beforeEach(() => {
  getSetting.mockClear();
  setSetting.mockClear();
  getSetting.mockResolvedValue(null);
  ids = new Set([1, 2]);
  api = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('useGraphCamera:位置记忆(只记拖过的节点)', () => {
  it('库里的记忆位置覆盖布局坐标,未记过的节点保持布局坐标', async () => {
    getSetting.mockResolvedValue('{"2":{"x":-50,"y":7}}');
    await mount();
    expect(getSetting).toHaveBeenCalledWith('graph_positions');
    expect(api!.points.get(2)).toEqual({ x: -50, y: 7 });
    expect(api!.points.get(1)).toEqual({ x: 0, y: 0 });
    expect(api!.points).not.toBe(layout); // 叠加后是新的 Map,布局结果不被改写
  });

  it('没有记忆(库值为空 / 坏 JSON / 数组)时直接用布局结果,连 Map 身份都不变', async () => {
    for (const raw of [null, '', '不是 JSON', '[]', '{"a":{"x":1,"y":2}}', '{"3":{"x":1}}']) {
      getSetting.mockResolvedValue(raw);
      root = createRoot(document.createElement('div'));
      await mount();
      expect(api!.points).toBe(layout);
      act(() => root.unmount());
    }
  });

  it('commitPositions:本地立刻生效(不等库的回包),并与库中已有条目合并后写回', async () => {
    getSetting.mockResolvedValue('{"1":{"x":1,"y":2}}');
    await mount();
    await act(async () => {
      api!.commitPositions({ '2': { x: 5, y: 6 } });
    });
    expect(api!.points.get(2)).toEqual({ x: 5, y: 6 }); // 还没落库,画面已经在新位置
    await act(flush);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(lastWrite()[0]).toBe('graph_positions');
    expect(JSON.parse(lastWrite()[1])).toEqual({ 1: { x: 1, y: 2 }, 2: { x: 5, y: 6 } });
  });

  it('写回按现存标签修剪:库里已删的标签不再占条目', async () => {
    getSetting.mockResolvedValue('{"1":{"x":1,"y":1},"99":{"x":9,"y":9}}');
    ids = new Set([1, 2]); // 99 已不在库里
    await mount();
    await act(async () => {
      api!.commitPositions({ '2': { x: 5, y: 6 } });
    });
    await act(flush);
    expect(JSON.parse(lastWrite()[1])).toEqual({ 1: { x: 1, y: 1 }, 2: { x: 5, y: 6 } });
  });
});

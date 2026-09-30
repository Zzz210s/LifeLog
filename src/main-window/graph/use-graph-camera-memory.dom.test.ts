// @vitest-environment jsdom
/**
 * 相机的位置记忆(只读叠加 + 合并写回):库里记过的节点覆盖布局坐标、坏值一律忽略、
 * `savePositions` 在库中已有条目上合并。
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
import {
  overlayPositions,
  parseGraphPositions,
  useGraphCamera,
  type GraphCameraApi,
} from './use-graph-camera';

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

function Harness(): null {
  api = useGraphCamera({ width: W, height: H, points: layout });
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

beforeEach(() => {
  getSetting.mockClear();
  setSetting.mockClear();
  getSetting.mockResolvedValue(null);
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

  it('savePositions 只写拖过的节点,并在库中已有条目上合并', async () => {
    getSetting.mockResolvedValue('{"9":{"x":1,"y":2}}');
    await mount();
    await act(async () => {
      await api!.savePositions({ 2: { x: 5, y: 6 } });
    });
    expect(setSetting).toHaveBeenCalledTimes(1);
    const [key, value] = setSetting.mock.calls[0] as unknown as [string, string];
    expect(key).toBe('graph_positions');
    expect(JSON.parse(value)).toEqual({ 9: { x: 1, y: 2 }, 2: { x: 5, y: 6 } });
  });

  it('parseGraphPositions 丢掉坐标非有限数的条目', () => {
    expect(parseGraphPositions('{"4":{"x":1e999,"y":0},"5":{"x":"1","y":0}}').size).toBe(0);
    expect(overlayPositions(new Map([[1, { x: 0, y: 0 }]]), new Map([[1, { x: 9, y: 9 }], [7, { x: 1, y: 1 }]])).size).toBe(1);
  });
});

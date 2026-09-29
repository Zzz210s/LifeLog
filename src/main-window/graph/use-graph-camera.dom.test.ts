// @vitest-environment jsdom
/**
 * 相机交互 hook:滚轮以光标为中心缩放(锚点不漂)、拖空白平移、`0` 复位、
 * 位置记忆只读叠加(只覆盖拖过的节点,坏值一律忽略)。
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

import { fitToView, MAX_K, MIN_K, type Camera } from './graph-camera';
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

const wheel = async (deltaY: number, at: Point = { x: 100, y: 100 }): Promise<() => void> => {
  const preventDefault = vi.fn();
  await act(async () => {
    api?.onWheel({
      deltaY,
      clientX: at.x,
      clientY: at.y,
      preventDefault,
    } as unknown as WheelEvent);
  });
  return preventDefault;
};

const key = async (k: string, mods: Partial<KeyboardEventInit> = {}): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...mods }));
  });
};

/** 屏幕点反解回世界坐标:缩放锚定的判据就是它前后不变 */
const worldOf = (screen: Point, cam: Camera): Point => ({
  x: (screen.x - cam.tx) / cam.k,
  y: (screen.y - cam.ty) / cam.k,
});

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

describe('useGraphCamera:滚轮缩放', () => {
  it('放大后光标下的世界点仍在原屏幕位置(以光标为中心,不是画布中心)', async () => {
    await mount();
    const cursor = { x: 100, y: 100 };
    const before = { ...api!.camera };
    const worldBefore = worldOf(cursor, before);
    const preventDefault = await wheel(-100, cursor);
    expect(api!.camera.k).toBeGreaterThan(before.k);
    expect(preventDefault).toHaveBeenCalled(); // 拦下页面滚动
    const worldAfter = worldOf(cursor, api!.camera);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('连续缩放夹在 MIN_K–MAX_K 之间,不会失控', async () => {
    await mount();
    for (let i = 0; i < 40; i++) await wheel(-120);
    expect(api!.camera.k).toBe(MAX_K);
    for (let i = 0; i < 80; i++) await wheel(120);
    expect(api!.camera.k).toBe(MIN_K);
  });
});

describe('useGraphCamera:拖空白平移与 0 复位', () => {
  it('拖空白:位移量等于光标位移;抬手后再移动不再平移', async () => {
    await mount();
    const before = { ...api!.camera };
    await act(async () => {
      api!.onPointerDown({ clientX: 10, clientY: 10 } as PointerEvent);
      api!.onPointerMove({ clientX: 30, clientY: 50 } as PointerEvent);
    });
    expect(api!.camera.tx).toBeCloseTo(before.tx + 20, 6);
    expect(api!.camera.ty).toBeCloseTo(before.ty + 40, 6);
    await act(async () => {
      api!.onPointerUp();
      api!.onPointerMove({ clientX: 200, clientY: 200 } as PointerEvent);
    });
    expect(api!.camera.tx).toBeCloseTo(before.tx + 20, 6);
  });

  it('按 0 复位到适配视图,带修饰键的 0 不算复位,卸载后监听已摘', async () => {
    await mount();
    await wheel(-120);
    await key('0');
    expect(api!.camera).toEqual(fitToView([...layout.values()], W, H));
    await wheel(-120);
    await key('0', { ctrlKey: true }); // Ctrl+0 是浏览器的缩放键,别被我们吞掉
    expect(api!.camera).not.toEqual(fitToView([...layout.values()], W, H));
    act(() => root.unmount());
    const atUnmount = { ...api!.camera };
    await key('0');
    expect(api!.camera).toEqual(atUnmount);
  });
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

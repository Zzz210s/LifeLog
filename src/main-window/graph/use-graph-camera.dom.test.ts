// @vitest-environment jsdom
/**
 * 相机交互 hook:滚轮以光标为中心缩放(锚点不漂,**容器有视口原点偏置也要对**)、拖空白平移、`0` 复位、
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
import { useGraphCamera, type GraphCameraApi } from './use-graph-camera';

const W = 400;
const H = 300;
/**
 * 容器不在视口原点(真机:左边侧栏 + 上边顶栏)。滚轮给的是 client 坐标、`zoomAt` 要的是画布坐标,
 * 所以夹具**不能是恒等原点** —— 恒等夹具会把这个真机缺陷放过(2026-09-30 终审修复轮)。
 */
const ORIGIN = { x: 292.5, y: 44 };
/** 布局结果(夹具):两个点,记忆位置只覆盖第二个 */
const layout: Map<number, Point> = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 100, y: 0 }],
]);

let api: GraphCameraApi | null = null;
let root: Root;
let host: HTMLDivElement;
let origin = { ...ORIGIN };

function Harness(): null {
  api = useGraphCamera({ width: W, height: H, points: layout, origin: () => origin });
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

/** `at` 是**画布**坐标:换成 client 再发 —— 原点换算正是被测的那一步 */
const wheel = async (deltaY: number, at: Point = { x: 100, y: 100 }): Promise<() => void> => {
  const preventDefault = vi.fn();
  await act(async () => {
    api?.onWheel({
      deltaY,
      clientX: at.x + origin.x,
      clientY: at.y + origin.y,
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
  origin = { ...ORIGIN };
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
  it('放大后光标下的世界点仍在原屏幕位置(以光标为中心,不是画布中心;容器有原点偏置也对)', async () => {
    await mount();
    const cursor = { x: 100, y: 100 };
    // 夹具自检:原点确实不在视口原点,否则这条用例又退回恒等夹具、放过真机缺陷
    expect(origin.x !== 0 || origin.y !== 0).toBe(true);
    const before = { ...api!.camera };
    const worldBefore = worldOf(cursor, before);
    const preventDefault = await wheel(-100, cursor);
    expect(api!.camera.k).toBeGreaterThan(before.k);
    expect(preventDefault).toHaveBeenCalled(); // 拦下页面滚动
    const worldAfter = worldOf(cursor, api!.camera);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('不传 origin 时按恒等原点处理(宿主贴视口原点,client 坐标即画布坐标)', async () => {
    const plain: { api: GraphCameraApi | null } = { api: null };
    const Plain = (): null => {
      plain.api = useGraphCamera({ width: W, height: H, points: layout });
      return null;
    };
    await act(async () => {
      root.render(createElement(Plain));
    });
    const cursor = { x: 100, y: 100 };
    const worldBefore = worldOf(cursor, plain.api!.camera);
    await act(async () => {
      plain.api!.onWheel({
        deltaY: -100,
        clientX: cursor.x,
        clientY: cursor.y,
        preventDefault: vi.fn(),
      } as unknown as WheelEvent);
    });
    const worldAfter = worldOf(cursor, plain.api!.camera);
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

  it('右键按下不平移(右键的拖拽不能挪画布,右键留给标签菜单)', async () => {
    await mount();
    const before = { ...api!.camera };
    await act(async () => {
      api!.onPointerDown({ clientX: 10, clientY: 10, button: 2 } as PointerEvent);
      api!.onPointerMove({ clientX: 90, clientY: 90 } as PointerEvent);
    });
    expect(api!.camera).toEqual(before);
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

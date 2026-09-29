// @vitest-environment jsdom
/**
 * 图内键盘缩放(设计 §5 的 `+` `-` `0`):`+`/`=` 放大、`-` 缩小,锚点取画布中心
 * (键盘没有光标位置可用);`0` 仍复位到适配视图;带修饰键的键位留给宿主(Ctrl+0 是浏览器缩放)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../shared/api', () => ({
  api: {
    getSetting: vi.fn(async (): Promise<string | null> => null),
    setSetting: vi.fn(async () => undefined),
  },
}));

import { fitToView, type Camera } from './graph-camera';
import type { Point } from './radial';
import { useGraphCamera, type GraphCameraApi } from './use-graph-camera';

const W = 400;
const H = 300;
/** 键盘缩放的锚点:画布中心 */
const CENTER: Point = { x: W / 2, y: H / 2 };
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

const key = async (k: string, mods: Partial<KeyboardEventInit> = {}): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...mods }));
  });
};

/** 屏幕点反解回世界坐标:锚点判据就是它前后不变 */
const worldOf = (screen: Point, cam: Camera): Point => ({
  x: (screen.x - cam.tx) / cam.k,
  y: (screen.y - cam.ty) / cam.k,
});

beforeEach(() => {
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

describe('useGraphCamera:图内键盘缩放', () => {
  it('按 + 放大、按 - 缩小,画布中心的世界点不动', async () => {
    await mount();
    const before = { ...api!.camera };
    const worldBefore = worldOf(CENTER, before);
    await key('+');
    const zoomed = { ...api!.camera };
    expect(zoomed.k).toBeGreaterThan(before.k);
    const worldAfter = worldOf(CENTER, zoomed);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    await key('-');
    expect(api!.camera.k).toBeCloseTo(before.k, 6);
    await key('='); // 无 Shift 的 `+` 键位(笔记本键盘常见)
    expect(api!.camera.k).toBeGreaterThan(before.k);
  });

  it('0 仍复位到适配视图;带修饰键的缩放键一律留给宿主', async () => {
    await mount();
    await key('+');
    await key('+');
    await key('0');
    expect(api!.camera).toEqual(fitToView([...layout.values()], W, H));
    await key('+', { ctrlKey: true });
    await key('-', { metaKey: true });
    await key('+', { altKey: true });
    expect(api!.camera).toEqual(fitToView([...layout.values()], W, H));
  });
});

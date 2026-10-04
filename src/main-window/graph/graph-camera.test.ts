import { describe, expect, it } from 'vitest';
import { MAX_K, MIN_K, cullVisible, fitToView, lodLevel, screenOf, zoomAt } from './graph-camera';

describe('相机:适配 / 缩放 / 裁剪 / LOD', () => {
  it('fitToView 把点框进画布并留边距', () => {
    const cam = fitToView([{ x: -100, y: -50 }, { x: 100, y: 50 }], 400, 300, 0.05);
    const a = screenOf({ x: -100, y: -50 }, cam);
    const b = screenOf({ x: 100, y: 50 }, cam);
    expect(a.x).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(400);
    expect(a.y).toBeGreaterThan(0);
    expect(b.y).toBeLessThan(300);
  });

  it('zoomAt 保持光标下的世界坐标不动', () => {
    const cam = { k: 1, tx: 0, ty: 0 };
    const world = { x: 30, y: -20 };
    const before = screenOf(world, cam);
    const zoomed = zoomAt(cam, 2, before);
    const after = screenOf(world, zoomed);
    expect(Math.round(after.x)).toBe(Math.round(before.x));
    expect(Math.round(after.y)).toBe(Math.round(before.y));
  });

  it('zoomAt 锚定已有平移的相机:放大触发夹取后光标下的世界点仍不动', () => {
    const cam = { k: 1, tx: 50, ty: -30 };
    const at = { x: 120, y: 80 };
    const world = { x: (at.x - cam.tx) / cam.k, y: (at.y - cam.ty) / cam.k };
    const zoomed = zoomAt(cam, 10, at);
    expect(zoomed.k).toBe(4); // factor=10 被夹到 MAX_K,夹取后仍需锚定
    const after = screenOf(world, zoomed);
    expect(after.x).toBeCloseTo(at.x, 10);
    expect(after.y).toBeCloseTo(at.y, 10);
  });

  it('缩放夹在 0.5–4', () => {
    expect(zoomAt({ k: 3, tx: 0, ty: 0 }, 10, { x: 0, y: 0 }).k).toBe(4);
    expect(zoomAt({ k: 0.3, tx: 0, ty: 0 }, 0.1, { x: 0, y: 0 }).k).toBe(0.5);
  });

  it('fitToView 极远点集夹到 MIN_K', () => {
    expect(fitToView([{ x: 0, y: 0 }, { x: 20000, y: 0 }], 400, 300).k).toBe(MIN_K);
  });

  it('fitToView 重合点集:k 有限且夹在范围内,该点落在画布中心', () => {
    const p = { x: 5, y: 7 };
    const cam = fitToView([p, p], 400, 300);
    expect(Number.isFinite(cam.k)).toBe(true);
    expect(cam.k).toBeGreaterThanOrEqual(MIN_K);
    expect(cam.k).toBeLessThanOrEqual(MAX_K);
    expect(screenOf(p, cam)).toEqual({ x: 200, y: 150 });
  });

  it('fitToView 空点集居中空视图', () => {
    expect(fitToView([], 400, 300)).toEqual({ k: 1, tx: 200, ty: 150 });
  });

  it('cullVisible 只返回视口内的点', () => {
    const pts = new Map([[1, { x: 0, y: 0 }], [2, { x: 5000, y: 5000 }]]);
    const cam = { k: 1, tx: 200, ty: 150 };
    expect(cullVisible(pts, cam, 400, 300)).toEqual([1]);
  });

  it('cullVisible 的 margin 是屏幕像素且边界含等号', () => {
    const cam = { k: 1, tx: 200, ty: 150 };
    const at = (x: number) => new Map([[1, { x, y: 0 }]]);
    expect(cullVisible(at(240), cam, 400, 300)).toEqual([1]); // 屏幕 x=440=w+margin
    expect(cullVisible(at(241), cam, 400, 300)).toEqual([]);
    expect(cullVisible(at(-240), cam, 400, 300)).toEqual([1]); // 屏幕 x=-40=-margin
    expect(cullVisible(at(-241), cam, 400, 300)).toEqual([]);
    expect(cullVisible(at(200), cam, 400, 300, 0)).toEqual([1]); // margin=0:屏幕 x=400
    expect(cullVisible(at(-200), cam, 400, 300, 0)).toEqual([1]);
  });

  it('LOD 三档边界', () => {
    expect(lodLevel(0.5)).toBe('dots');
    expect(lodLevel(0.9)).toBe('hubs');
    expect(lodLevel(1.5)).toBe('all');
  });

  it('LOD 精确边界:0.6 与 1.2 都归 hubs', () => {
    expect(lodLevel(0.59)).toBe('dots');
    expect(lodLevel(0.6)).toBe('hubs');
    expect(lodLevel(1.2)).toBe('hubs');
    expect(lodLevel(1.21)).toBe('all');
  });
});

import { describe, expect, it } from 'vitest';
import { cullVisible, fitToView, lodLevel, screenOf, zoomAt } from './graph-camera';

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

  it('缩放夹在 0.2–4', () => {
    expect(zoomAt({ k: 3, tx: 0, ty: 0 }, 10, { x: 0, y: 0 }).k).toBe(4);
    expect(zoomAt({ k: 0.3, tx: 0, ty: 0 }, 0.1, { x: 0, y: 0 }).k).toBe(0.2);
  });

  it('cullVisible 只返回视口内的点', () => {
    const pts = new Map([[1, { x: 0, y: 0 }], [2, { x: 5000, y: 5000 }]]);
    const cam = { k: 1, tx: 200, ty: 150 };
    expect(cullVisible(pts, cam, 400, 300)).toEqual([1]);
  });

  it('LOD 三档边界', () => {
    expect(lodLevel(0.5)).toBe('dots');
    expect(lodLevel(0.9)).toBe('hubs');
    expect(lodLevel(1.5)).toBe('all');
  });
});

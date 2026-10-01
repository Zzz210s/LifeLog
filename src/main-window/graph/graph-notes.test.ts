import { describe, expect, it } from 'vitest';
import { NOTE_LIMIT, OVERFLOW_GAP, noteFan } from './graph-notes';

describe('noteFan:展开笔记的小圆布局', () => {
  it('按数量均匀铺在圆上', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: 4, radius: 40, space: 'world' });
    expect(r.dots).toHaveLength(4);
    expect(r.overflow).toBe(null);
    for (const d of r.dots) expect(Math.round(Math.hypot(d.x, d.y))).toBe(40);
  });

  it('第一个小圆在正上方,之后顺时针(截图对比要有稳定锚点)', () => {
    const r = noteFan({ center: { x: 5, y: 5 }, count: 4, radius: 20, space: 'world' });
    expect(r.dots[0].x).toBeCloseTo(5);
    expect(r.dots[0].y).toBeCloseTo(-15); // 正上方
    expect(r.dots[1].x).toBeCloseTo(25); // 右侧
    expect(r.dots[1].y).toBeCloseTo(5);
  });

  it('超过上限时只画前 limit 个,并给 +N(摆在环外偏下)', () => {
    const r = noteFan({ center: { x: 10, y: 20 }, count: 25, radius: 40, limit: 20, space: 'world' });
    expect(r.dots).toHaveLength(20);
    expect(r.overflow).toEqual({ x: 10, y: 20 + 40 + OVERFLOW_GAP, n: 5 });
  });

  it('不传 limit 时用默认上限 20', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: 25, radius: 40, space: 'world' });
    expect(NOTE_LIMIT).toBe(20);
    expect(r.dots).toHaveLength(20);
    expect(r.overflow).toEqual({ x: 0, y: 40 + OVERFLOW_GAP, n: 5 });
  });

  it('+N 在环外偏下:离圆心的距离 = 半径 + 间距,比任何同心的实现都远', () => {
    const center = { x: 12, y: 34 };
    const radius = 17; // 小标签的扇形半径(屏幕口径)
    const r = noteFan({ center, count: 25, radius, space: 'screen' });
    expect(r.overflow).toEqual({ x: 12, y: 34 + radius + OVERFLOW_GAP, n: 5 });
    expect(r.overflow!.y).toBeGreaterThan(center.y); // 偏下方
    expect(r.overflow!.y - center.y).toBeGreaterThan(radius); // 在环外,不与小圆重叠
    // `+N` 的命中半径是 10(OVERFLOW_REACH):离圆心 ≥ radiusOf(0) + 14 + 12 ≈ 28.5,
    // 所以点小标签的圆心再也撞不上它(2026-10-01 修:此前它在圆心、整块盖住小标签点)
    expect(Math.hypot(r.overflow!.x - center.x, r.overflow!.y - center.y)).toBeGreaterThan(10);
  });

  it('0 条不画任何东西', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: 0, radius: 40, space: 'world' });
    expect(r.dots).toHaveLength(0);
    expect(r.overflow).toBe(null);
  });

  it('负数按 0 条处理(不画小圆,也没有 +N)', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: -3, radius: 40, space: 'world' });
    expect(r.dots).toHaveLength(0);
    expect(r.overflow).toBe(null);
  });

  it('刚好等于上限时没有 +N', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: 20, radius: 40, space: 'world' });
    expect(r.dots).toHaveLength(20);
    expect(r.overflow).toBe(null);
  });

  it('limit 为 0 时一个不画,+N 是全部(仍在环外偏下)', () => {
    const r = noteFan({ center: { x: 1, y: 2 }, count: 7, radius: 40, limit: 0, space: 'world' });
    expect(r.dots).toHaveLength(0);
    expect(r.overflow).toEqual({ x: 1, y: 2 + 40 + OVERFLOW_GAP, n: 7 });
  });
});

describe('noteFan:口径显式化(定死,别再摇摆)', () => {
  it('空间原样回传,点位按传入的 center/radius 铺（自己不做任何相机换算）', () => {
    const world = noteFan({ center: { x: 0, y: 0 }, count: 4, radius: 40, space: 'world' });
    const screen = noteFan({ center: { x: 0, y: 0 }, count: 4, radius: 40, space: 'screen' });
    expect(world.space).toBe('world');
    expect(screen.space).toBe('screen');
    // 同一份入参 -> 同一份点位:量纲只由调用方决定,函数只照单铺点
    expect(screen.dots).toEqual(world.dots);
    expect(screen.overflow).toBe(null);
  });

  it('+N 提示位也落在同一量纲的环外偏下', () => {
    const screen = noteFan({ center: { x: 12, y: 34 }, count: 25, radius: 17, space: 'screen' });
    expect(screen.space).toBe('screen');
    expect(screen.overflow).toEqual({ x: 12, y: 34 + 17 + OVERFLOW_GAP, n: 5 });
  });
});

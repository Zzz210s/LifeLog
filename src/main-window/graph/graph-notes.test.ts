import { describe, expect, it } from 'vitest';
import { NOTE_LIMIT, noteFan } from './graph-notes';

describe('noteFan:展开笔记的小圆布局', () => {
  it('按数量均匀铺在圆上', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: 4, radius: 40 });
    expect(r.dots).toHaveLength(4);
    expect(r.overflow).toBe(null);
    for (const d of r.dots) expect(Math.round(Math.hypot(d.x, d.y))).toBe(40);
  });

  it('第一个小圆在正上方,之后顺时针(截图对比要有稳定锚点)', () => {
    const r = noteFan({ center: { x: 5, y: 5 }, count: 4, radius: 20 });
    expect(r.dots[0].x).toBeCloseTo(5);
    expect(r.dots[0].y).toBeCloseTo(-15); // 正上方
    expect(r.dots[1].x).toBeCloseTo(25); // 右侧
    expect(r.dots[1].y).toBeCloseTo(5);
  });

  it('超过上限时只画前 limit 个,并给 +N', () => {
    const r = noteFan({ center: { x: 10, y: 20 }, count: 25, radius: 40, limit: 20 });
    expect(r.dots).toHaveLength(20);
    expect(r.overflow).toEqual({ x: 10, y: 20, n: 5 });
  });

  it('不传 limit 时用默认上限 20', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: 25, radius: 40 });
    expect(NOTE_LIMIT).toBe(20);
    expect(r.dots).toHaveLength(20);
    expect(r.overflow).toEqual({ x: 0, y: 0, n: 5 });
  });

  it('0 条不画任何东西', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: 0, radius: 40 });
    expect(r.dots).toHaveLength(0);
    expect(r.overflow).toBe(null);
  });

  it('负数按 0 条处理(不画小圆,也没有 +N)', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: -3, radius: 40 });
    expect(r.dots).toHaveLength(0);
    expect(r.overflow).toBe(null);
  });

  it('刚好等于上限时没有 +N', () => {
    const r = noteFan({ center: { x: 0, y: 0 }, count: 20, radius: 40 });
    expect(r.dots).toHaveLength(20);
    expect(r.overflow).toBe(null);
  });

  it('limit 为 0 时一个不画,+N 是全部', () => {
    const r = noteFan({ center: { x: 1, y: 2 }, count: 7, radius: 40, limit: 0 });
    expect(r.dots).toHaveLength(0);
    expect(r.overflow).toEqual({ x: 1, y: 2, n: 7 });
  });
});

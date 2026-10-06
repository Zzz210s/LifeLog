// @vitest-environment jsdom
/**
 * 画布上的 link 层(L4):accent 色、线宽 1.5、画在点**下面**(线穿过小圆时圆还看得见)。
 * 靠 canvas-test-kit 的调用时序快照,不看代码:设色的第 3 笔就是 link 层
 * (共现 border-strong -> 父子 border-strong -> 链接 accent -> 笔记小圆 border-strong)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountCanvas, strokeCalls, type CanvasHarness } from './canvas-test-kit';
import type { DrawPlan } from './graph-draw-plan';

const empty: DrawPlan = {
  co: [], tree: [], links: [], relations: [], hubs: [], dots: [], labels: [], notes: [],
  relationMarks: [], overflow: null,
};

const seg = (x1: number, y1: number, x2: number, y2: number): DrawPlan['links'][number] => ({
  x1, y1, x2, y2, weight: 1, emphasized: false, dim: false,
});

let h: CanvasHarness;
beforeEach(() => {
  h = mountCanvas();
  document.documentElement.style.setProperty('--color-accent', 'rgb(44, 44, 44)');
});
afterEach(() => h.cleanup());

describe('GraphCanvas:笔记间的链接边', () => {
  it('按 accent 色 1.5 画,且画在笔记小圆之前(线在圆下面)', async () => {
    const plan: DrawPlan = {
      ...empty,
      links: [seg(60, 200, 100, 200), seg(100, 200, 140, 200)],
      notes: [
        { id: 501, x: 60, y: 200 },
        { id: 502, x: 100, y: 200 },
      ],
    };
    await h.render(plan, 100, 100, 'light');
    // 两条 link 段同色同宽同透明 -> 合并成一次 dot-line stroke;后两条是笔记小圆(1)
    expect(strokeCalls(h.ctx.calls).map((c) => c.lineWidth)).toEqual([1.5, 1, 1]);
    expect(strokeCalls(h.ctx.calls).map((c) => c.alpha)).toEqual([1, 1, 1]);
    // 设色顺序 = 共现 -> 父子 -> 链接 -> 笔记小圆,第 3 笔是链接层(前两层的令牌没定义 -> transparent)
    expect(h.ctx.writes.strokeStyle[2]).toBe('rgb(44, 44, 44)');
    expect(h.ctx.moveTo).toHaveBeenCalledWith(60, 200);
    expect(h.ctx.lineTo).toHaveBeenCalledWith(100, 200);
    const ops = h.ctx.calls.map((c) => c.op);
    expect(ops.indexOf('stroke')).toBeLessThan(ops.indexOf('arc')); // 先画线,再画圆
  });

  it('link 段自己不带弱化:有 dim 的点时它仍满不透明(弱化只由段上的标志决定)', async () => {
    const plan: DrawPlan = {
      ...empty,
      links: [seg(60, 200, 100, 200)],
      hubs: [], dots: [{ id: 1, x: 60, y: 200, r: 3, color: 'c', dim: true, selected: false }],
    };
    await h.render(plan, 100, 100, 'light');
    expect(strokeCalls(h.ctx.calls)).toHaveLength(1);
    expect(strokeCalls(h.ctx.calls)[0].alpha).toBe(1);
  });
});

// @vitest-environment jsdom
/**
 * 2026-10-06 关系图**边视觉重做**的画布口径(时序快照,不看代码):
 * - 父子(轴色)边:取段上 `color`(父节点根轴色)、实线、1.5px、70%
 * - 共现边:`--color-border-strong` **虚线(6/3)**、1.25px、65%(2026-10-06 提亮加粗加长)
 * - 笔记链接边:accent **点线(1/4)**、1.5px
 * - 关系边:accent 实线 + 终点箭头(与链接边同色同宽,箭头是唯一区别)
 * - 弱化:轴色边 25%、非轴色边 15%;计划层给 `alpha = 1` 的同轴边满不透明
 * - **复位**:虚线/点线画完必须 `setLineDash([])`,不许漏到后面的点与文字上
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountCanvas, strokeCalls, type CanvasHarness } from './canvas-test-kit';
import type { DrawPlan } from './graph-draw-plan';

const empty: DrawPlan = {
  co: [], tree: [], links: [], relations: [], hubs: [], dots: [], labels: [], notes: [],
  relationMarks: [], overflow: null,
};
const seg = (
  x1: number, y1: number, x2: number, y2: number, extra: Partial<DrawPlan['co'][number]> = {},
): DrawPlan['co'][number] => ({ x1, y1, x2, y2, weight: 1, emphasized: false, dim: false, ...extra });

let h: CanvasHarness;
beforeEach(() => {
  h = mountCanvas();
  document.documentElement.style.setProperty('--color-border', 'rgb(11, 11, 11)');
  document.documentElement.style.setProperty('--color-border-strong', 'rgb(22, 22, 22)');
  document.documentElement.style.setProperty('--color-accent', 'rgb(44, 44, 44)');
});
afterEach(() => h.cleanup());

describe('GraphCanvas:边视觉重做', () => {
  it('父子边取段上轴色、实线 1.5 / 70%;共现边虚线 6/3、1.25 / 65%,色走 border-strong', async () => {
    const plan: DrawPlan = {
      ...empty,
      co: [seg(0, 0, 10, 0)],
      tree: [seg(0, 0, 0, 10, { color: 'rgb(7, 7, 7)' })],
    };
    await h.render(plan, 100, 100, 'light');
    const strokes = strokeCalls(h.ctx.calls);
    expect(strokes.map((c) => c.lineWidth)).toEqual([1.25, 1.5]);
    expect(strokes.map((c) => c.dash)).toEqual([[6, 3], []]);
    expect(strokes.map((c) => c.alpha)).toEqual([0.65, 0.7]);
    // 设色顺序:共现层默认 border-strong -> 父子层默认 border-strong -> 该段自己的轴色 -> 链接层 accent
    expect(h.ctx.writes.strokeStyle).toEqual([
      'rgb(22, 22, 22)', 'rgb(22, 22, 22)', 'rgb(7, 7, 7)', 'rgb(44, 44, 44)',
    ]);
  });

  it('笔记链接边:accent 点线 1/4、1.5px', async () => {
    await h.render({ ...empty, links: [seg(0, 0, 10, 0)] }, 100, 100, 'light');
    const strokes = strokeCalls(h.ctx.calls);
    expect(strokes.map((c) => c.lineWidth)).toEqual([1.5]);
    expect(strokes.map((c) => c.dash)).toEqual([[1, 4]]);
    expect(strokes[0].alpha).toBe(1);
    expect(h.ctx.writes.strokeStyle[2]).toBe('rgb(44, 44, 44)');
  });

  it('弱化:轴色边 25%、非轴色边 15%;计划层给 alpha=1 的同轴边满不透明', async () => {
    const plan: DrawPlan = {
      ...empty,
      co: [seg(0, 0, 10, 0, { dim: true })],
      tree: [
        seg(0, 0, 0, 10, { dim: true }),
        seg(0, 0, 0, 20, { alpha: 1 }),
      ],
      links: [seg(0, 0, 10, 10, { dim: true })],
    };
    await h.render(plan, 100, 100, 'light');
    expect(strokeCalls(h.ctx.calls).map((c) => c.alpha)).toEqual([0.15, 0.25, 1, 0.15]);
  });

  it('关系边仍是 accent 实线 + 终点箭头(线型不乱)', async () => {
    const plan: DrawPlan = {
      ...empty,
      relations: [seg(0, 0, 100, 0, { arrow: true })],
    };
    await h.render(plan, 100, 100, 'light');
    const strokes = strokeCalls(h.ctx.calls);
    expect(strokes.map((c) => c.lineWidth)).toEqual([1.5]);
    expect(strokes.map((c) => c.dash)).toEqual([[]]);
    expect(h.ctx.fill).toHaveBeenCalledTimes(1);
  });

  it('虚线/点线画完复位:点与文字的绘制动作上手边 dash 为空', async () => {
    const plan: DrawPlan = {
      ...empty,
      co: [seg(0, 0, 10, 0)],
      links: [seg(0, 0, 10, 10)],
      dots: [{ id: 1, x: 5, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: false, selected: false }],
      labels: [{ id: 1, x: 5, y: -7, text: '时间' }],
    };
    await h.render(plan, 100, 100, 'light');
    expect(strokeCalls(h.ctx.calls).some((c) => c.dash.length > 0)).toBe(true); // 真有虚线/点线
    expect(h.ctx.calls.find((c) => c.op === 'arc')!.dash).toEqual([]);
    expect(h.ctx.calls.find((c) => c.op === 'fillText')!.dash).toEqual([]);
  });
});

describe('GraphCanvas:边批次合并(一次 path 一次 stroke)', () => {
  it('同色同透明度同线宽的多条边合并成一次 stroke,线段一条不少', async () => {
    const plan: DrawPlan = {
      ...empty,
      co: [seg(0, 0, 10, 0), seg(0, 5, 10, 5), seg(0, 9, 10, 9)],
      tree: [seg(0, 0, 0, 10, { color: 'rgb(7, 7, 7)' }), seg(0, 20, 0, 30, { color: 'rgb(7, 7, 7)' })],
    };
    await h.render(plan, 100, 100, 'light');
    const strokes = strokeCalls(h.ctx.calls);
    expect(strokes).toHaveLength(2); // 三层 co 一组 + tree 一组
    expect(strokes.map((c) => c.lineWidth)).toEqual([1.25, 1.5]);
    expect(strokes.map((c) => c.alpha)).toEqual([0.65, 0.7]);
    // 所有线段仍然进了 path(moveTo/lineTo 次数 = 边数),不是丢了边
    expect(h.ctx.moveTo).toHaveBeenCalledTimes(5);
    expect(h.ctx.lineTo).toHaveBeenCalledTimes(5);
  });

  it('颜色 / 透明度 / 线宽任一不同就不合并(强调边与弱化边各成一组)', async () => {
    const plan: DrawPlan = {
      ...empty,
      co: [seg(0, 0, 10, 0), seg(0, 5, 10, 5, { dim: true }), seg(0, 9, 10, 9, { emphasized: true })],
    };
    await h.render(plan, 100, 100, 'light');
    expect(strokeCalls(h.ctx.calls)).toHaveLength(3);
  });
});

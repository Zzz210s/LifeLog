// @vitest-environment jsdom
/**
 * 画布上的关系边层(Task 5):accent 色 1.5px **带箭头**,画在点下面;
 * 与同色同宽的笔记链接边可区分 —— 只有关系边在终点画一个实心箭头(`fill`)。
 * 备注文字走 `relationMarks`(只在 k >= 1.2 时由绘制计划给出),画在箭头中点、muted 色。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountCanvas, strokeCalls, type CanvasHarness } from './canvas-test-kit';
import type { DrawPlan } from './graph-draw-plan';

const empty: DrawPlan = {
  co: [], tree: [], links: [], relations: [], hubs: [], dots: [], labels: [], notes: [],
  relationMarks: [], overflow: null,
};

const arrowSeg = (x1: number, y1: number, x2: number, y2: number): DrawPlan['relations'][number] => ({
  x1, y1, x2, y2, weight: 1, emphasized: false, dim: false, arrow: true,
});
const linkSeg = (x1: number, y1: number, x2: number, y2: number): DrawPlan['links'][number] => ({
  x1, y1, x2, y2, weight: 1, emphasized: false, dim: false,
});

let h: CanvasHarness;
beforeEach(() => {
  h = mountCanvas();
  document.documentElement.style.setProperty('--color-accent', 'rgb(44, 44, 44)');
  document.documentElement.style.setProperty('--color-muted', 'rgb(33, 33, 33)');
});
afterEach(() => h.cleanup());

describe('GraphCanvas:关系边', () => {
  it('按 accent 色 1.5 画,并在终点画实心箭头(与笔记链接边只差箭头)', async () => {
    await h.render({ ...empty, relations: [arrowSeg(0, 0, 100, 0)] }, 100, 100, 'light');
    expect(strokeCalls(h.ctx.calls).map((c) => c.lineWidth)).toEqual([1.5]);
    expect(h.ctx.writes.strokeStyle).toContain('rgb(44, 44, 44)');
    // 箭头三角:线到 (100,0),箭头尖从 10px 处往回收,`fill` 画一次
    expect(h.ctx.fill).toHaveBeenCalledTimes(1);
    // 箭头用 accent,结尾统一设的文字色是 muted
    expect(h.ctx.writes.fillStyle).toEqual(['rgb(44, 44, 44)', 'rgb(33, 33, 33)']);
    const moved = (h.ctx.moveTo as unknown as { mock: { calls: number[][] } }).mock.calls;
    expect(moved).toContainEqual([90, 0]);
  });

  it('笔记链接边不带箭头:同样 accent 1.5 但不画箭头', async () => {
    await h.render({ ...empty, links: [linkSeg(0, 0, 100, 0)] }, 100, 100, 'light');
    expect(strokeCalls(h.ctx.calls).map((c) => c.lineWidth)).toEqual([1.5]);
    expect(h.ctx.fill).not.toHaveBeenCalled();
    expect(h.ctx.writes.fillStyle).toEqual(['rgb(33, 33, 33)']); // 只设了一次文字色,没有箭头
  });

  it('禁用弱化:dim 的关系边箭头也跟着降透明度(线宽仍 1.5)', async () => {
    await h.render(
      { ...empty, relations: [{ ...arrowSeg(0, 0, 100, 0), dim: true }] },
      100, 100, 'light',
    );
    expect(strokeCalls(h.ctx.calls)[0].alpha).toBe(0.2);
    expect(h.ctx.fill).toHaveBeenCalledTimes(1);
  });

  it('备注文字:muted 色画在中点(位置由绘制计划给出)', async () => {
    await h.render(
      { ...empty, relations: [arrowSeg(0, 0, 100, 0)], relationMarks: [{ x: 50, y: 0, text: '国别' }] },
      100, 100, 'light',
    );
    expect(h.ctx.fillText).toHaveBeenCalledWith('国别', 50, 0);
    expect(h.ctx.writes.fillStyle).toEqual(['rgb(44, 44, 44)', 'rgb(33, 33, 33)']);
  });
});

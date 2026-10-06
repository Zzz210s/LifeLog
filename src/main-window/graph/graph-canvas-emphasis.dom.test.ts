// 画布强调态的时序口径(靠 canvas-test-kit 的调用快照,不看代码):
//   ① 强调边(与焦点相连)线宽 2.5,同类型的普通边 1.5 / 1
//   ② 强调边即使 dim(焦点另一头是无关点)也不弱化
//   ③ 弱化归位只有一处:暗点或暗边之后,紧随的选中环 / 笔记小圆 / +N / 文字都是满不透明
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountCanvas, strokeCalls, type CanvasHarness } from './canvas-test-kit';
import type { DrawPlan } from './graph-draw-plan';

const empty: DrawPlan = {
  co: [], tree: [], links: [], relations: [], hubs: [], dots: [], labels: [], notes: [],
  relationMarks: [], overflow: null,
};

let h: CanvasHarness;
beforeEach(() => {
  h = mountCanvas();
});
afterEach(() => h.cleanup());

const seg = (x: number, emphasized: boolean, dim: boolean): DrawPlan['co'][number] => ({
  x1: x,
  y1: 0,
  x2: x,
  y2: 10,
  weight: 1,
  emphasized,
  dim,
});

describe('GraphCanvas:强调边与弱化归位', () => {
  it('强调边按 2.5 画且 dim 也不弱化;同类型的普通边仍是 1.5 / 1', async () => {
    const plan: DrawPlan = {
      ...empty,
      co: [seg(0, false, false), seg(5, true, true), seg(9, false, true)],
      tree: [seg(20, false, false), seg(25, true, false)],
    };
    await h.render(plan, 100, 100, 'light');
    // 顺序 = co 三条 + tree 两条
    expect(strokeCalls(h.ctx.calls).map((c) => c.lineWidth)).toEqual([1, 2.5, 1, 1.5, 2.5]);
    // 共现基础 0.5(强调也 0.5)/ 弱化 0.15;父子基础 0.7(强调也不淡)
    expect(strokeCalls(h.ctx.calls).map((c) => c.alpha)).toEqual([0.5, 0.5, 0.15, 0.7, 0.7]);
  });

  it('弱化归位:暗点之后紧随的选中环、笔记小圆、+N 与文字都是满不透明', async () => {
    const plan: DrawPlan = {
      ...empty,
      hubs: [], dots: [{ id: 1, x: 5, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: true, selected: true }],
      notes: [{ id: 7, x: 20, y: 30 }],
      overflow: { id: 1, x: 5, y: 6, n: 5 },
      labels: [{ id: 1, x: 5, y: -7, text: '时间' }],
    };
    await h.render(plan, 100, 100, 'light');
    expect(h.ctx.calls.find((c) => c.op === 'fill')!.alpha).toBe(0.2); // 先证明真的画了一个暗点
    expect(h.ctx.calls.filter((c) => c.op === 'stroke').map((c) => c.alpha)).toEqual([1, 1]); // 选中环、笔记小圆
    expect(h.ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.alpha)).toEqual([1, 1]); // +N、标签
  });

  it('弱化归位:图里一个点都没有时,只剩暗边的图也不让文字继承那 0.15', async () => {
    const plan: DrawPlan = {
      ...empty,
      co: [seg(0, false, true)],
      overflow: { id: 1, x: 5, y: 6, n: 5 },
      labels: [{ id: 1, x: 5, y: -7, text: '时间' }],
    };
    await h.render(plan, 100, 100, 'light');
    expect(strokeCalls(h.ctx.calls).map((c) => c.alpha)).toEqual([0.15]);
    expect(h.ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.alpha)).toEqual([1, 1]);
  });
});

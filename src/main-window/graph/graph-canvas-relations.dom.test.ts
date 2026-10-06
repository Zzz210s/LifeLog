// @vitest-environment jsdom
/**
 * 画布上的关系边层(Task 5):accent 色 1.5px **带箭头**,画在点下面;
 * 与同色同宽的笔记链接边可区分 —— 只有关系边在终点画一个实心箭头(`fill`)。
 * 备注文字走 `relationMarks`(只在 k >= 1.2 时由绘制计划给出),画在箭头附近、muted 色,
 * 每一条**先垫一层 raised 底 + border 描边的圆角矩形**再写字(否则与节点标签同字体同色读不出),
 * 且画在节点标签**之前**(标签是读图主体,不能被备注压住);弱化态(`dim`)也作用到备注。
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
const mark = (x: number, y: number, text: string, dim = false): DrawPlan['relationMarks'][number] => ({
  x, y, text, dim,
});

let h: CanvasHarness;
beforeEach(() => {
  h = mountCanvas();
  document.documentElement.style.setProperty('--color-accent', 'rgb(44, 44, 44)');
  document.documentElement.style.setProperty('--color-muted', 'rgb(33, 33, 33)');
  document.documentElement.style.setProperty('--color-raised', 'rgb(200, 200, 200)');
  document.documentElement.style.setProperty('--color-border', 'rgb(150, 150, 150)');
});
afterEach(() => h.cleanup());

/** 某次动作在调用序列里的下标(找不到回 -1) */
const at = (pred: (c: CanvasHarness['ctx']['calls'][number], i: number) => boolean): number =>
  h.ctx.calls.findIndex(pred);

describe('GraphCanvas:关系边', () => {
  it('按 accent 色 1.5 画,并在终点画实心箭头(与笔记链接边只差箭头)', async () => {
    await h.render({ ...empty, relations: [arrowSeg(0, 0, 100, 0)] }, 100, 100, 'light');
    expect(strokeCalls(h.ctx.calls).map((c) => c.lineWidth)).toEqual([1.5]);
    expect(h.ctx.writes.strokeStyle).toContain('rgb(44, 44, 44)');
    // 箭头三角:线到 (100,0),箭头尖按计划给的回收量退,`fill` 画一次
    expect(h.ctx.fill).toHaveBeenCalledTimes(1);
    // 箭头用 accent,结尾统一设的文字色是 muted
    expect(h.ctx.writes.fillStyle).toEqual(['rgb(44, 44, 44)', 'rgb(33, 33, 33)']);
    const moved = (h.ctx.moveTo as unknown as { mock: { calls: number[][] } }).mock.calls;
    expect(moved).toContainEqual([90, 0]);
  });

  it('箭头尖按计划给的回收量退(目标半径大时退得更远)', async () => {
    await h.render(
      { ...empty, relations: [{ ...arrowSeg(0, 0, 100, 0), pullback: 24 }] },
      100, 100, 'light',
    );
    const moved = (h.ctx.moveTo as unknown as { mock: { calls: number[][] } }).mock.calls;
    expect(moved).toContainEqual([76, 0]); // 100 - 24
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

  it('备注文字:muted 色画在计划给的位置', async () => {
    await h.render(
      { ...empty, relations: [arrowSeg(0, 0, 100, 0)], relationMarks: [mark(50, 9, '国别')] },
      100, 100, 'light',
    );
    expect(h.ctx.fillText).toHaveBeenCalledWith('国别', 50, 9);
  });

  it('备注先垫 raised 底 + border 描边的圆角矩形,且画在节点标签之前(判别力)', async () => {
    await h.render(
      {
        ...empty,
        labels: [{ id: 1, x: 10, y: 10, text: '甲' }],
        relationMarks: [mark(50, 0, '国别')],
      },
      100, 100, 'light',
    );
    const iRR = at((c) => c.op === 'roundRect');
    const iFill = at((c, i) => i > iRR && c.op === 'fill');
    const iMark = at((c) => c.op === 'fillText' && c.args[0] === '国别');
    const iLabel = at((c) => c.op === 'fillText' && c.args[0] === '甲');
    expect(iRR).toBeGreaterThan(-1);
    expect(iFill).toBeGreaterThan(iRR); // 圆角矩形被 fill(底衬)
    expect(iMark).toBeGreaterThan(iRR); // 字画在底衬之后
    expect(iLabel).toBeGreaterThan(iMark); // 标签压在备注之上
    // 颜色全部走令牌,零硬编码:底衬 raised、描边 border
    expect(h.ctx.writes.fillStyle).toContain('rgb(200, 200, 200)');
    expect(h.ctx.writes.strokeStyle).toContain('rgb(150, 150, 150)');
    expect((h.ctx.roundRect as unknown as { mock: { calls: number[][] } }).mock.calls[0][4]).toBe(4);
  });

  it('弱化的备注连底衬带字一起降透明度(dim 生效)', async () => {
    await h.render(
      { ...empty, relationMarks: [mark(50, 0, '国别', true)] },
      100, 100, 'light',
    );
    expect(h.ctx.calls.find((c) => c.op === 'roundRect')!.alpha).toBe(0.2);
    expect(h.ctx.calls.find((c) => c.op === 'fillText' && c.args[0] === '国别')!.alpha).toBe(0.2);
  });
});

// @vitest-environment jsdom
/**
 * 备注层的三件性能口径(2026-10-06 性能轮)—— 断言的是"画了几次、量了几次、设了几次色",
 * 不是像素:像素口径在 `graph-canvas-relations.dom.test.ts`。
 *
 * ① 字宽按 (ctx, 字体, 文字) 缓存:同一条备注每帧都要量一次是纯浪费(备注文本来自库里的属性名);
 *    缓存挂在上下文对象上,所以**另一个画布上下文不会命中**,不会把上一个画布的字体度量串出去。
 * ② 令牌每帧只读一次:三个色(底衬/描边/文字)一次读完,不是每条备注各读一遍。
 * ③ 同值赋值跳过:`strokeStyle` / `lineWidth` 逐条相同,此前每条写一次,现在一次。
 *    `fillStyle` 不跳:底衬色与文字色逐条交替是绘制顺序要求的(z 序一改就是改外观)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeCanvasCtx, type CanvasCtxStub } from './canvas-test-kit';
import { drawRelationMarks, remarkWidth } from './graph-canvas-remarks';

const asCtx = (stub: CanvasCtxStub): CanvasRenderingContext2D => stub as unknown as CanvasRenderingContext2D;
const mark = (x: number, y: number, text: string, dim = false) => ({ x, y, text, dim });

let ctx: CanvasCtxStub;
beforeEach(() => {
  ctx = makeCanvasCtx();
  document.documentElement.style.setProperty('--color-raised', 'rgb(200, 200, 200)');
  document.documentElement.style.setProperty('--color-border', 'rgb(150, 150, 150)');
  document.documentElement.style.setProperty('--color-muted', 'rgb(33, 33, 33)');
});
afterEach(() => {
  ['--color-raised', '--color-border', '--color-muted'].forEach((t) => document.documentElement.style.removeProperty(t));
});

describe('备注字宽缓存', () => {
  it('同一条备注量一次就够(第二次不再调 measureText)', () => {
    const first = remarkWidth(asCtx(ctx), '国别');
    const second = remarkWidth(asCtx(ctx), '国别');
    expect(second).toBe(first);
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    expect(first).toBe(14); // 替身口径:宽度 = 字符数 × 7
  });

  it('换一个画布上下文必须重新量(缓存不许跨画布串味)', () => {
    const other = makeCanvasCtx();
    remarkWidth(asCtx(ctx), '国别');
    remarkWidth(asCtx(other), '国别');
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    expect(other.measureText).toHaveBeenCalledTimes(1);
  });
});

describe('drawRelationMarks:令牌与设色次数', () => {
  it('描边色与线宽各写一次；底衬色与文字色逐条交替(z 序要求,不得跳)', () => {
    drawRelationMarks(asCtx(ctx), [mark(10, 10, '国别'), mark(20, 20, '别名'), mark(30, 30, '出处')]);
    expect(ctx.writes.fillStyle).toEqual([
      'rgb(200, 200, 200)', 'rgb(33, 33, 33)',
      'rgb(200, 200, 200)', 'rgb(33, 33, 33)',
      'rgb(200, 200, 200)', 'rgb(33, 33, 33)',
    ]);
    expect(ctx.writes.strokeStyle).toEqual(['rgb(150, 150, 150)']);
    expect(ctx.writes.lineWidth).toEqual([1]);
    // 每条仍然逐个画:底衬 -> 描边 -> 字(顺序不变)
    expect(ctx.calls.filter((c) => c.op === 'roundRect')).toHaveLength(3);
    expect(ctx.calls.filter((c) => c.op === 'fill')).toHaveLength(3);
    expect(ctx.calls.filter((c) => c.op === 'stroke')).toHaveLength(3);
    expect(ctx.calls.filter((c) => c.op === 'fillText')).toHaveLength(3);
    expect(ctx.measureText).toHaveBeenCalledTimes(3);
  });

  it('空层:一次绘制都不发生(不碰令牌)', () => {
    drawRelationMarks(asCtx(ctx), []);
    expect(ctx.calls).toEqual([]);
    expect(ctx.writes.fillStyle).toEqual([]);
    expect(ctx.writes.strokeStyle).toEqual([]);
  });

  it('弱化的备注逐条降透明度,收尾归位(后续标签不受影响)', () => {
    drawRelationMarks(asCtx(ctx), [mark(10, 10, '国别', true), mark(20, 20, '别名')]);
    const alphas = ctx.calls.filter((c) => c.op === 'roundRect').map((c) => c.alpha);
    expect(alphas).toEqual([0.2, 1]);
    expect(ctx.writes.globalAlpha[ctx.writes.globalAlpha.length - 1]).toBe(1);
  });
});

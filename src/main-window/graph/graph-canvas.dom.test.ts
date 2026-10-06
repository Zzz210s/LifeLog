// 「plan 引用不变则静止不重绘」的用例(设计 §3.3「静止 0 CPU」的实现方式):
//   ① 首次挂载画一次(并按 DPR=2 设后备缓冲)
//   ② 同 plan 同尺寸再渲染 -> 连 effect 都不跑
//   ③ 尺寸变了但 plan 引用没变 -> 守卫拦住:不重绘、后备缓冲也不动
//      (plan 是尺寸的纯函数,尺寸变化必然带来新 plan;这条是"静止"能被观测到的唯一入口)
//   ④ 主题键变了 -> 必须重绘(颜色是画的时候从令牌读的)
//   ⑤ 换了新 plan 对象 -> 必须重绘
// 线宽随强调态变、弱化归位不留尾:见 graph-canvas-emphasis.dom.test.ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountCanvas, type CanvasHarness } from './canvas-test-kit';
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

const render = (plan: DrawPlan, width: number, height: number, themeKey: string) => h.render(plan, width, height, themeKey);

describe('GraphCanvas:同一 plan 不重绘', () => {
  it('plan 引用不变时不再重绘,主题或 plan 变化才重绘', async () => {
    await render(empty, 100, 100, 'light');
    const canvas = h.host.querySelector('canvas')!;
    expect(h.getContext).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(200); // 100 * DPR 2
    expect(canvas.height).toBe(200);
    expect(h.ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);

    await render(empty, 100, 100, 'light'); // 完全相同的 props
    expect(h.getContext).toHaveBeenCalledTimes(1);

    await render(empty, 200, 120, 'light'); // 尺寸变、plan 未变 -> 守卫拦住
    expect(h.getContext).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(200); // 后备缓冲没动

    await render(empty, 200, 120, 'dark'); // 亮暗切换 -> 重绘
    expect(h.getContext).toHaveBeenCalledTimes(2);
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(240);

    const next: DrawPlan = {
      co: [], tree: [], links: [], relations: [], hubs: [], dots: [], labels: [], notes: [],
      relationMarks: [], overflow: null,
    };
    await render(next, 200, 120, 'dark'); // 新 plan -> 重绘
    expect(h.getContext).toHaveBeenCalledTimes(3);
  });

  it('绘制指令落成画布调用:边按类型取线宽,链接层取 accent,点色来自 plan,文字色取主题令牌', async () => {
    document.documentElement.style.setProperty('--color-border', 'rgb(11, 11, 11)');
    document.documentElement.style.setProperty('--color-border-strong', 'rgb(22, 22, 22)');
    document.documentElement.style.setProperty('--color-muted', 'rgb(33, 33, 33)');
    document.documentElement.style.setProperty('--color-accent', 'rgb(44, 44, 44)');
    const plan: DrawPlan = {
      co: [{ x1: 0, y1: 0, x2: 10, y2: 0, weight: 3, emphasized: false, dim: false }],
      links: [],
      relations: [],
      tree: [{ x1: 0, y1: 0, x2: 0, y2: 10, weight: 1, emphasized: false, dim: false }],
      hubs: [], dots: [{ id: 1, x: 5, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: false, selected: false }],
      labels: [{ id: 1, x: 5, y: -7, text: '时间' }],
      notes: [],
      relationMarks: [],
      overflow: null,
    };
    await render(plan, 100, 100, 'light');
    expect(h.ctx.clearRect).toHaveBeenCalledWith(0, 0, 100, 100);
    expect(h.ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(h.ctx.lineTo).toHaveBeenCalledWith(10, 0);
    expect(h.ctx.lineTo).toHaveBeenCalledWith(0, 10);
    expect(h.ctx.arc).toHaveBeenCalledWith(5, 6, 9, 0, Math.PI * 2);
    expect(h.ctx.fill).toHaveBeenCalledTimes(1);
    expect(h.ctx.fillText).toHaveBeenCalledWith('时间', 5, -7);
    // 三层边各取一次色:共现 border / 父子 border-strong / 链接 accent(link 层空也照设,与另两层同一手法)
    expect(h.ctx.writes.strokeStyle).toEqual(['rgb(11, 11, 11)', 'rgb(22, 22, 22)', 'rgb(44, 44, 44)']);
    expect(h.ctx.writes.fillStyle).toEqual(['rgb(1, 2, 3)', 'rgb(33, 33, 33)']);
  });

  it('主题令牌缺失时颜色退回 transparent,不写死色值', async () => {
    await render({ ...empty, hubs: [], dots: [], labels: [] }, 10, 10, 'light'); // jsdom 里三个令牌都没定义
    expect(h.ctx.writes.fillStyle).toEqual(['transparent']);
  });

  it('弱化用 globalAlpha 表达,dim 的点与边降透明度而不换色', async () => {
    const plan: DrawPlan = {
      ...empty,
      co: [{ x1: 0, y1: 0, x2: 10, y2: 0, weight: 1, emphasized: false, dim: true }],
      hubs: [], dots: [
        { id: 1, x: 5, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: false, selected: false },
        { id: 2, x: 40, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: true, selected: false },
      ],
    };
    await render(plan, 100, 100, 'light');
    // 一条 co(暗)边(非轴色边弱化档 0.15)与一个暗点(点弱化档 0.2)
    expect(h.ctx.writes.globalAlpha.filter((a) => a === 0.2)).toHaveLength(1);
    expect(h.ctx.writes.globalAlpha.filter((a) => a === 0.15)).toHaveLength(1);
    expect(h.ctx.writes.globalAlpha).toContain(1);
    // 颜色不因弱化而变:两个点同色
    expect(h.ctx.writes.fillStyle).toEqual(['rgb(1, 2, 3)', 'rgb(1, 2, 3)', 'transparent']);
  });

  it('选中环、笔记小圆与 +N:各自用令牌描边,笔记不参与弱化', async () => {
    document.documentElement.style.setProperty('--color-border-strong', 'rgb(22, 22, 22)');
    document.documentElement.style.setProperty('--color-muted', 'rgb(33, 33, 33)');
    document.documentElement.style.setProperty('--color-accent', 'rgb(44, 44, 44)');
    const plan: DrawPlan = {
      ...empty,
      hubs: [], dots: [{ id: 1, x: 5, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: true, selected: true }],
      notes: [
        { id: 7, x: 20, y: 30 },
        { id: 8, x: 24, y: 30 },
      ],
      overflow: { id: 1, x: 5, y: 6, n: 5 },
    };
    await render(plan, 100, 100, 'light');
    // 点被弱化,但选中环仍按满不透明画:环用 accent,半径 = r + 3
    expect(h.ctx.writes.strokeStyle).toContain('rgb(44, 44, 44)');
    expect(h.ctx.arc).toHaveBeenCalledWith(5, 6, 12, 0, Math.PI * 2);
    // 笔记小圆是空心小圆,半径固定 3,颜色取 border-strong
    expect(h.ctx.arc).toHaveBeenCalledWith(20, 30, 3, 0, Math.PI * 2);
    expect(h.ctx.arc).toHaveBeenCalledWith(24, 30, 3, 0, Math.PI * 2);
    expect(h.ctx.fillText).toHaveBeenCalledWith('+5', 5, 6);
    expect(h.ctx.writes.fillStyle).toEqual(['rgb(1, 2, 3)', 'rgb(33, 33, 33)']);
  });
});

// 「plan 引用不变则静止不重绘」的用例(设计 §3.3「静止 0 CPU」的实现方式):
//   ① 首次挂载画一次(并按 DPR=2 设后备缓冲)
//   ② 同 plan 同尺寸再渲染 -> 连 effect 都不跑
//   ③ 尺寸变了但 plan 引用没变 -> 守卫拦住:不重绘、后备缓冲也不动
//      (plan 是尺寸的纯函数,尺寸变化必然带来新 plan;这条是"静止"能被观测到的唯一入口)
//   ④ 主题键变了 -> 必须重绘(颜色是画的时候从令牌读的)
//   ⑤ 换了新 plan 对象 -> 必须重绘
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { DrawPlan } from './graph-draw-plan';
import { GraphCanvas } from './GraphCanvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
const TOKENS = ['--color-border', '--color-border-strong', '--color-muted', '--color-accent'] as const;

const empty: DrawPlan = { co: [], tree: [], dots: [], labels: [], notes: [], overflow: null };

/** 画布上下文替身:除调用计数外,还记录 fillStyle/strokeStyle/globalAlpha 的每次赋值(颜色与弱化口径靠它钉住) */
type Ctx = Record<string, ReturnType<typeof vi.fn>> & {
  writes: { fillStyle: string[]; strokeStyle: string[]; globalAlpha: number[] };
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let ctx: Ctx;
let getContext: MockInstance<HTMLCanvasElement['getContext']>;

function makeCtx(): Ctx {
  const writes = { fillStyle: [] as string[], strokeStyle: [] as string[], globalAlpha: [] as number[] };
  const stub: Record<string, unknown> = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    writes,
  };
  for (const key of ['fillStyle', 'strokeStyle'] as const) {
    Object.defineProperty(stub, key, {
      get: () => writes[key][writes[key].length - 1],
      set: (v: string) => writes[key].push(v),
    });
  }
  Object.defineProperty(stub, 'globalAlpha', {
    get: () => writes.globalAlpha[writes.globalAlpha.length - 1],
    set: (v: number) => writes.globalAlpha.push(v),
  });
  return stub as Ctx;
}

beforeEach(() => {
  ctx = makeCtx();
  getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  getContext.mockRestore();
  if (desc) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', desc);
  TOKENS.forEach((t) => document.documentElement.style.removeProperty(t));
  root = null;
  host = null;
});

async function render(plan: DrawPlan, width: number, height: number, themeKey: string): Promise<void> {
  await act(async () => {
    root?.render(createElement(GraphCanvas, { plan, width, height, themeKey }));
  });
}

describe('GraphCanvas:同一 plan 不重绘', () => {
  it('plan 引用不变时不再重绘,主题或 plan 变化才重绘', async () => {
    await render(empty, 100, 100, 'light');
    const canvas = host!.querySelector('canvas')!;
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(200); // 100 * DPR 2
    expect(canvas.height).toBe(200);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);

    await render(empty, 100, 100, 'light'); // 完全相同的 props
    expect(getContext).toHaveBeenCalledTimes(1);

    await render(empty, 200, 120, 'light'); // 尺寸变、plan 未变 -> 守卫拦住
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(200); // 后备缓冲没动

    await render(empty, 200, 120, 'dark'); // 亮暗切换 -> 重绘
    expect(getContext).toHaveBeenCalledTimes(2);
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(240);

    const next: DrawPlan = { co: [], tree: [], dots: [], labels: [], notes: [], overflow: null };
    await render(next, 200, 120, 'dark'); // 新 plan -> 重绘
    expect(getContext).toHaveBeenCalledTimes(3);
  });

  it('绘制指令落成画布调用:边按类型取线宽,点色来自 plan,文字色取主题令牌', async () => {
    document.documentElement.style.setProperty('--color-border', 'rgb(11, 11, 11)');
    document.documentElement.style.setProperty('--color-border-strong', 'rgb(22, 22, 22)');
    document.documentElement.style.setProperty('--color-muted', 'rgb(33, 33, 33)');
    const plan: DrawPlan = {
      co: [{ x1: 0, y1: 0, x2: 10, y2: 0, weight: 3, dim: false }],
      tree: [{ x1: 0, y1: 0, x2: 0, y2: 10, weight: 1, dim: false }],
      dots: [{ id: 1, x: 5, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: false, selected: false }],
      labels: [{ id: 1, x: 5, y: -7, text: '时间' }],
      notes: [],
      overflow: null,
    };
    await render(plan, 100, 100, 'light');
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 100, 100);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(0, 10);
    expect(ctx.arc).toHaveBeenCalledWith(5, 6, 9, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('时间', 5, -7);
    expect(ctx.writes.strokeStyle).toEqual(['rgb(11, 11, 11)', 'rgb(22, 22, 22)']);
    expect(ctx.writes.fillStyle).toEqual(['rgb(1, 2, 3)', 'rgb(33, 33, 33)']);
  });

  it('主题令牌缺失时颜色退回 transparent,不写死色值', async () => {
    await render({ ...empty, dots: [], labels: [] }, 10, 10, 'light'); // jsdom 里三个令牌都没定义
    expect(ctx.writes.fillStyle).toEqual(['transparent']);
  });

  it('弱化用 globalAlpha 表达,dim 的点与边降透明度而不换色', async () => {
    const plan: DrawPlan = {
      ...empty,
      co: [{ x1: 0, y1: 0, x2: 10, y2: 0, weight: 1, dim: true }],
      dots: [
        { id: 1, x: 5, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: false, selected: false },
        { id: 2, x: 40, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: true, selected: false },
      ],
    };
    await render(plan, 100, 100, 'light');
    // 两条边? 不:一条 co(暗)与两个点(一亮一暗) -> 0.2 出现两次, 1 至少两次
    expect(ctx.writes.globalAlpha.filter((a) => a === 0.2)).toHaveLength(2);
    expect(ctx.writes.globalAlpha).toContain(1);
    // 颜色不因弱化而变:两个点同色
    expect(ctx.writes.fillStyle).toEqual(['rgb(1, 2, 3)', 'rgb(1, 2, 3)', 'transparent']);
  });

  it('选中环、笔记小圆与 +N:各自用令牌描边,笔记不参与弱化', async () => {
    document.documentElement.style.setProperty('--color-border-strong', 'rgb(22, 22, 22)');
    document.documentElement.style.setProperty('--color-muted', 'rgb(33, 33, 33)');
    document.documentElement.style.setProperty('--color-accent', 'rgb(44, 44, 44)');
    const plan: DrawPlan = {
      ...empty,
      dots: [{ id: 1, x: 5, y: 6, r: 9, color: 'rgb(1, 2, 3)', dim: true, selected: true }],
      notes: [
        { x: 20, y: 30 },
        { x: 24, y: 30 },
      ],
      overflow: { x: 5, y: 6, n: 5 },
    };
    await render(plan, 100, 100, 'light');
    // 点被弱化,但选中环仍按满不透明画:环用 accent,半径 = r + 3
    expect(ctx.writes.strokeStyle).toContain('rgb(44, 44, 44)');
    expect(ctx.arc).toHaveBeenCalledWith(5, 6, 12, 0, Math.PI * 2);
    // 笔记小圆是空心小圆,半径固定 3,颜色取 border-strong
    expect(ctx.arc).toHaveBeenCalledWith(20, 30, 3, 0, Math.PI * 2);
    expect(ctx.arc).toHaveBeenCalledWith(24, 30, 3, 0, Math.PI * 2);
    expect(ctx.fillText).toHaveBeenCalledWith('+5', 5, 6);
    expect(ctx.writes.fillStyle).toEqual(['rgb(1, 2, 3)', 'rgb(33, 33, 33)']);
  });
});

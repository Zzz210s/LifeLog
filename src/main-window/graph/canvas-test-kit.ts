/**
 * `GraphCanvas` 用例的共享测试件(仅测试引用,不进应用代码):
 * - `makeCanvasCtx`:画布上下文替身 —— `writes` 按属性记赋值顺序,`calls` 记 stroke / arc / fill /
 *   fillText **发生时刻**的 `globalAlpha` 与 `lineWidth`(从未赋值取画布默认值 1)
 * - `mountCanvas`:jsdom 里的挂载件(DPR 固定 2),给出 `render` / `cleanup`
 *
 * 为什么要时序快照:「上一段画完有没有把 alpha 归位」「这条边用了多粗的线」看代码看不出来,
 * 只有记录「每个绘制动作当时的画布状态」才咬得住(见 graph-canvas-emphasis.dom.test.ts)。
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { vi, type MockInstance } from 'vitest';
import type { DrawPlan } from './graph-draw-plan';
import { GraphCanvas } from './GraphCanvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKENS = ['--color-border', '--color-border-strong', '--color-muted', '--color-accent'] as const;

export interface CtxCall {
  op: 'stroke' | 'arc' | 'fill' | 'fillText' | 'roundRect';
  /** 该次调用发生时的 globalAlpha */
  alpha: number;
  /** 该次调用发生时的 lineWidth */
  lineWidth: number;
  args: unknown[];
}

export interface CanvasCtxStub extends Record<string, unknown> {
  writes: { fillStyle: string[]; strokeStyle: string[]; globalAlpha: number[]; lineWidth: number[] };
  calls: CtxCall[];
}

function last<T>(xs: readonly T[], fallback: T): T {
  return xs.length > 0 ? xs[xs.length - 1] : fallback;
}

/** 只取描边类调用(顺序即绘制顺序:co 在前、tree 在后) */
export function strokeCalls(calls: readonly CtxCall[]): CtxCall[] {
  return calls.filter((c) => c.op === 'stroke');
}

/** 画布上下文替身:除调用计数外,还记录颜色 / 透明度 / 线宽的每次赋值与每次绘制的时序快照 */
export function makeCanvasCtx(): CanvasCtxStub {
  const writes = {
    fillStyle: [] as string[],
    strokeStyle: [] as string[],
    globalAlpha: [] as number[],
    lineWidth: [] as number[],
  };
  const calls: CtxCall[] = [];
  const rec = (op: CtxCall['op'], args: unknown[]): void => {
    calls.push({ op, alpha: last(writes.globalAlpha, 1), lineWidth: last(writes.lineWidth, 1), args });
  };
  const stub: Record<string, unknown> = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn((...args: unknown[]) => rec('stroke', args)),
    arc: vi.fn((...args: unknown[]) => rec('arc', args)),
    fill: vi.fn((...args: unknown[]) => rec('fill', args)),
    fillText: vi.fn((...args: unknown[]) => rec('fillText', args)),
    roundRect: vi.fn((...args: unknown[]) => rec('roundRect', args)),
    rect: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: String(text).length * 7 })),
    writes,
    calls,
  };
  for (const key of ['fillStyle', 'strokeStyle'] as const) {
    Object.defineProperty(stub, key, {
      get: () => last(writes[key], ''),
      set: (v: string) => writes[key].push(v),
    });
  }
  for (const key of ['globalAlpha', 'lineWidth'] as const) {
    Object.defineProperty(stub, key, {
      get: () => last(writes[key], 1),
      set: (v: number) => writes[key].push(v),
    });
  }
  return stub as CanvasCtxStub;
}

export interface CanvasHarness {
  ctx: CanvasCtxStub;
  host: HTMLDivElement;
  getContext: MockInstance<HTMLCanvasElement['getContext']>;
  /** 挂载 / 重渲染(act 包裹) */
  render(plan: DrawPlan, width: number, height: number, themeKey: string): Promise<void>;
  /** 卸载、还原原型上的 getContext、清掉主题令牌 */
  cleanup(): void;
}

export function mountCanvas(): CanvasHarness {
  const ctx = makeCanvasCtx();
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    ctx,
    host,
    getContext,
    async render(plan, width, height, themeKey) {
      await act(async () => {
        root.render(createElement(GraphCanvas, { plan, width, height, themeKey }));
      });
    },
    cleanup() {
      act(() => root.unmount());
      host.remove();
      getContext.mockRestore();
      TOKENS.forEach((t) => document.documentElement.style.removeProperty(t));
    },
  };
}

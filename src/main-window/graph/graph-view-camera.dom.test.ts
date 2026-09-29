// @vitest-environment jsdom
/**
 * GraphView 的接线面(Task 6 + Task 5 审查遗留三条):
 * 换主题必须重建 plan(点色是计划期读的令牌,不重建会残留旧主题色);
 * 画布后备缓冲跟容器尺寸走,读数没变的 resize 不白重建 plan;
 * 卸载后迟到的 IPC 回包不碰状态;`0` 复位与 `Esc` 退出两条 window 监听互不吞。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphData } from '../../shared/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { graphData } = vi.hoisted(() => ({
  graphData: vi.fn(
    async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => ({
      nodes: [
        { id: 1, path: '时间', depth: 1, parent: null, notes: 1177 },
        { id: 2, path: '时间/日期', depth: 2, parent: 1, notes: 1040 },
        { id: 3, path: '地点', depth: 1, parent: null, notes: 779 },
      ],
      edges: [{ a: 1, b: 2, kind: 'tree' as const, weight: 1 }],
    }),
  ),
}));
vi.mock('../../shared/api', () => ({
  api: {
    graphData,
    getSetting: vi.fn(async (): Promise<string | null> => null),
    setSetting: vi.fn(async () => undefined),
  },
}));

import { GraphView } from './GraphView';

let root: Root;
let host: HTMLDivElement;

/** 画布上下文替身:fillStyle 的每次赋值都记进 paint(换主题时点色跟没跟上看它) */
const paint: string[] = [];
const ctxStub = {
  setTransform: (): void => {}, clearRect: (): void => {}, beginPath: (): void => {},
  moveTo: (): void => {}, lineTo: (): void => {}, stroke: (): void => {},
  arc: (): void => {}, fill: (): void => {}, fillText: (): void => {},
  strokeStyle: '', lineWidth: 0, font: '', textAlign: '' as CanvasTextAlign,
  set fillStyle(v: string) { paint.push(v); },
  get fillStyle(): string { return paint[paint.length - 1] ?? ''; },
};

const stubContext = () =>
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctxStub as unknown as CanvasRenderingContext2D,
  );

/** 容器实测尺寸的可变读数(jsdom 没有布局引擎,只能在原型上挂 getter);返回还原函数 */
const metrics = (w: () => number, h: () => number): (() => void) => {
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { get: w, configurable: true });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { get: h, configurable: true });
  return () => {
    delete (HTMLDivElement.prototype as { clientWidth?: unknown }).clientWidth;
    delete (HTMLDivElement.prototype as { clientHeight?: unknown }).clientHeight;
  };
};

const mount = async (onExit: () => void): Promise<void> => {
  await act(async () => {
    root.render(createElement(GraphView, { onExit }));
  });
};

const key = async (k: string): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  });
};

beforeEach(() => {
  graphData.mockClear();
  paint.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('GraphView:换主题重建 plan(点色跟随)', () => {
  it('暗色 class 一变就重建 plan 并重绘,点色与文字色一起换到新主题', async () => {
    let muted = 'light-muted';
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({ getPropertyValue: (n: string) => (n === '--color-muted' ? muted : '#000') }) as unknown as CSSStyleDeclaration,
    );
    const getContext = stubContext();
    // 容器必须有实测尺寸:尺寸为 0 时 plan 是空计划(没有点),点色也就无从观测
    const restore = metrics(() => 400, () => 300);
    try {
      await mount(() => {});
      expect([...new Set(paint)]).toEqual(['light-muted']); // 有图:点色取自兜底令牌
      paint.length = 0;
      const calls = getContext.mock.calls.length;
      muted = 'dark-muted';
      await act(async () => {
        document.documentElement.classList.add('dark');
      });
      expect(getContext.mock.calls.length).toBe(calls + 1); // 换主题必然重绘
      expect([...new Set(paint)]).toEqual(['dark-muted']); // 亮色一点不剩 = plan 连同点色一起重建了
      // 摘 class 也要包在 act 里(它同样触发一次重渲染),否则会报 state 更新未包裹
      await act(async () => {
        document.documentElement.classList.remove('dark');
      });
    } finally {
      restore();
    }
  });
});

describe('GraphView:画布尺寸', () => {
  it('后备缓冲随容器尺寸变化;尺寸没变时再发 resize 不白重建 plan', async () => {
    const getContext = stubContext();
    let cw = 400;
    let ch = 300;
    const restore = metrics(() => cw, () => ch);
    try {
      await mount(() => {});
      const canvas = host.querySelector('canvas');
      expect([canvas?.width, canvas?.height]).toEqual([400, 300]);
      const calls = getContext.mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(getContext.mock.calls.length).toBe(calls); // 读数没变 -> setSize 保持原对象,plan 不重建
      cw = 500;
      ch = 400;
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });
      expect([canvas?.width, canvas?.height]).toEqual([500, 400]);
    } finally {
      restore();
    }
  });
});

describe('GraphView:迟到的回包', () => {
  it('卸载后回包才落地:不碰状态(无控制台错误,画布也不复活)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubContext(); // jsdom 自己会为未实现的支持打 console.error,先装上替身
    const gate: { release?: (d: GraphData) => void } = {};
    graphData.mockImplementationOnce(() => new Promise<GraphData>((res) => { gate.release = res; }));
    await mount(() => {});
    act(() => root.unmount());
    await act(async () => {
      gate.release?.({ nodes: [], edges: [] });
      await Promise.resolve();
    });
    expect(error).not.toHaveBeenCalled();
    expect(host.textContent).toBe('');
  });
});

describe('GraphView:0 复位与 Esc 互不吞', () => {
  it('按 0 走复位路径(重绘)且不退出;Esc 仍照常退出', async () => {
    const onExit = vi.fn();
    const getContext = stubContext();
    const restore = metrics(() => 400, () => 300);
    try {
      await mount(onExit);
      const calls = getContext.mock.calls.length;
      await key('0');
      expect(getContext.mock.calls.length).toBe(calls + 1);
      expect(onExit).not.toHaveBeenCalled();
      await key('Escape');
      expect(onExit).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});

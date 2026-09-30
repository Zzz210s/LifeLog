// @vitest-environment jsdom
/**
 * GraphView 视图外壳:数据只拉一次、默认折叠时间轴后计数对得上、Esc 回信息流。
 * 夹具与计划一致(时间 1177 / 时间-日期 1040 / 地点 779):折叠「时间」后应只剩两个节点,
 * 且「时间 -> 时间/日期」这条父子边因一端不可见被丢弃。
 * 折叠哪一根不再是常量:从设置 `time_tag_template` 派生(G2),故 getSetting 按键回答。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { graphData, getSetting, setSetting } = vi.hoisted(() => ({
  graphData: vi.fn(async () => ({
    nodes: [
      { id: 1, path: '时间', depth: 1, parent: null, notes: 1177, selfCount: 137, sortOrder: 0 },
      { id: 2, path: '时间/日期', depth: 2, parent: 1, notes: 1040, selfCount: 1040, sortOrder: 0 },
      { id: 3, path: '地点', depth: 1, parent: null, notes: 779, selfCount: 779, sortOrder: 0 },
    ],
    edges: [{ a: 1, b: 2, kind: 'tree' as const, weight: 1 }],
  })),
  // time_tag_template 是折叠根的真源(图这边的根名「时间」);graph_positions 是相机位置记忆
  getSetting: vi.fn(async (key: string): Promise<string | null> =>
    key === 'time_tag_template' ? '时间/{y}/{m}/{d}' : null,
  ),
  setSetting: vi.fn(async () => undefined),
}));
// getSetting 是相机 hook 读位置记忆的入口(G2 起才会写回)
vi.mock('../../shared/api', () => ({ api: { graphData, getSetting, setSetting } }));

import { GraphView } from './GraphView';

let root: Root;
let host: HTMLDivElement;

/** 挂载并等首次数据加载落定 */
const mount = async (onExit: () => void): Promise<void> => {
  await act(async () => {
    root.render(createElement(GraphView, { onExit }));
  });
};

beforeEach(() => {
  graphData.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('GraphView:拉数据与默认折叠', () => {
  it('数据只拉一次;默认折叠「时间」后只剩时间与地点(悬挂边一并丢弃)', async () => {
    await mount(() => {});
    expect(graphData).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('2 个节点 / 0 条边');
  });

  it('画布与计数浮层都渲染出来了', async () => {
    await mount(() => {});
    expect(host.querySelector('[data-testid="graph-view"]')).not.toBeNull();
    expect(host.querySelector('canvas')).not.toBeNull();
  });

  it('模板根名不是库里的根时一根都不折(折叠根跟设置走,不再写死「时间」)', async () => {
    // 模板读数先于相机读 graph_positions(tpl 的 effect 声明在 useGraphCamera 之前),
    // 故这一发 Once 落在模板上;若将来改了 hook 顺序,这里会红而不是静默绿。
    getSetting.mockResolvedValueOnce('时间排序/{y}/{m}/{d}');
    await mount(() => {});
    expect(host.textContent).toContain('3 个节点 / 1 条边');
  });
});

describe('GraphView:Esc 退出', () => {
  it('按 Esc 触发 onExit(退回信息流)', async () => {
    const onExit = vi.fn();
    await mount(onExit);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('卸载后不再响应 Esc(监听已摘)', async () => {
    const onExit = vi.fn();
    await mount(onExit);
    act(() => root.unmount());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe('GraphView:加载失败', () => {
  it('拉取失败给中文提示,不装作空图', async () => {
    graphData.mockRejectedValueOnce(new Error('库读不了'));
    await mount(() => {});
    expect(host.textContent).toContain('关系图加载失败');
  });
});

/** 画布上下文替身:只要不是 null,GraphCanvas 就会记账(重绘与否靠调用次数观测) */
const ctxStub = {
  setTransform: (): void => {}, clearRect: (): void => {}, beginPath: (): void => {},
  moveTo: (): void => {}, lineTo: (): void => {}, stroke: (): void => {},
  arc: (): void => {}, fill: (): void => {}, fillText: (): void => {},
  strokeStyle: '', fillStyle: '', lineWidth: 0, font: '', textAlign: '' as CanvasTextAlign,
};

describe('GraphView:尺寸变化重建几何', () => {
  it('容器实测尺寸变了就重建几何并重绘(plan 的 memo 依赖含 size,否则位图被拉伸)', async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ctxStub as unknown as CanvasRenderingContext2D);
    // 容器尺寸在渲染前就该是量到的值(原型上挂可变读数),这样首次适配相机的补偿帧在 resize 之前跑完
    let cw = 400;
    let ch = 300;
    const define = (name: 'clientWidth' | 'clientHeight', get: () => number): void => {
      Object.defineProperty(HTMLDivElement.prototype, name, { get, configurable: true });
    };
    define('clientWidth', () => cw);
    define('clientHeight', () => ch);
    try {
      await mount(() => {});
      const before = getContext.mock.calls.length;
      expect(before).toBeGreaterThan(0); // 有图时必然画过
      cw = 500;
      ch = 400;
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(getContext.mock.calls.length).toBe(before + 1);
    } finally {
      delete (HTMLDivElement.prototype as { clientWidth?: unknown }).clientWidth;
      delete (HTMLDivElement.prototype as { clientHeight?: unknown }).clientHeight;
    }
  });
});

describe('GraphView:纯 DPR 变化(尺寸量不出差别)', () => {
  it('CSS 尺寸一点没变、只有 devicePixelRatio 变:仍然重建几何并重设后备缓冲', async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ctxStub as unknown as CanvasRenderingContext2D);
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { get: () => 400, configurable: true });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { get: () => 300, configurable: true });
    // 400 这个读数量化后在 1.25 与 1.5 下相同(400×1.25 与 400×1.5 都是整数)-> size 对象身份不变
    const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    let dpr = 1.25;
    Object.defineProperty(window, 'devicePixelRatio', { get: () => dpr, configurable: true });
    try {
      await mount(() => {});
      const canvas = host.querySelector('canvas');
      expect([canvas?.width, canvas?.height]).toEqual([500, 375]);
      const calls = getContext.mock.calls.length;
      dpr = 1.5;
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });
      expect([canvas?.width, canvas?.height]).toEqual([600, 450]);
      expect(getContext.mock.calls.length).toBe(calls + 1);
    } finally {
      delete (HTMLDivElement.prototype as { clientWidth?: unknown }).clientWidth;
      delete (HTMLDivElement.prototype as { clientHeight?: unknown }).clientHeight;
      if (original !== undefined) Object.defineProperty(window, 'devicePixelRatio', original);
    }
  });
});

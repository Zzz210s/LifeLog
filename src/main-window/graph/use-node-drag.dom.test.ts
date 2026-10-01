// @vitest-environment jsdom
/**
 * 拖节点(useNodeDrag):容器指针事件的**总入口** —— 命中节点就拖那一个(世界位移 = 屏幕位移 / k,
 * 只改它,不重算布局);没命中就把整件事转交相机拖空白平移,拖节点时相机一下都不动。
 * 松手把落点交给 `commitPositions`(**没移动过就不留位置**);指针捕获走真机的 `setPointerCapture`。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../shared/types';
import type { Point } from './radial';
import type { GraphCameraApi } from './use-graph-camera';
import { useNodeDrag, type NodeDragApi, type NodeDragPointer } from './use-node-drag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NODES: GraphNode[] = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 4, selfCount: 4, sortOrder: 0 },
  { id: 2, path: '丙', depth: 1, parent: null, notes: 4, selfCount: 4, sortOrder: 0 },
];
/** 画布落点(相机那份):节点 1 在世界原点,节点 2 在 (100,0);hitTest 的触及半径 = 2.5 + 4 */
const BASE: Map<number, Point> = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 100, y: 0 }],
]);
/** k = 2:屏幕位移 (40,20) 应换成世界位移 (20,10) —— 量纲换算错了立刻对不上,不会静默过 */
const CAM = { k: 2, tx: 0, ty: 0 };

/** 相机替身:平移三步与写回都记调用;`points`/`camera` 就是相机那份 */
const pan = {
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  commitPositions: vi.fn(),
};
const cam = { camera: CAM, points: BASE, ...pan } as unknown as GraphCameraApi;

const el = document.createElement('div');
const capture = { set: vi.fn(), release: vi.fn() };
el.setPointerCapture = capture.set;
el.releasePointerCapture = capture.release;

let api: NodeDragApi | null = null;
let root: Root;
let host: HTMLDivElement;
let origin = { x: 0, y: 0 };

function Harness(): null {
  api = useNodeDrag({ nodes: NODES, cam, origin: () => origin });
  return null;
}

const current = (): NodeDragApi => {
  if (api === null) throw new Error('先 await h.mount() 再用 h.api()');
  return api;
};

beforeEach(() => {
  api = null;
  origin = { x: 0, y: 0 };
  for (const spy of Object.values(pan)) spy.mockClear();
  capture.set.mockClear();
  capture.release.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** 事件替身:`currentTarget` 是被捕获的容器(真机上 React 合成事件给的就是它) */
const ev = (x: number, y: number, extra: Partial<NodeDragPointer> = {}): NodeDragPointer => ({
  clientX: x,
  clientY: y,
  pointerId: 7,
  currentTarget: el,
  ...extra,
});

interface Step {
  mount(): Promise<void>;
  api(): NodeDragApi;
  down(x: number, y: number, extra?: Partial<NodeDragPointer>): Promise<void>;
  move(x: number, y: number): Promise<void>;
  up(): Promise<void>;
  leave(): Promise<void>;
  setOrigin(o: Point): void;
}

const step: Step = {
  async mount() {
    await act(async () => {
      root.render(createElement(Harness));
    });
  },
  api: current,
  async down(x, y, extra = {}) {
    await act(async () => current().onPointerDown(ev(x, y, extra)));
  },
  async move(x, y) {
    await act(async () => current().onPointerMove(ev(x, y)));
  },
  async up() {
    await act(async () => current().onPointerUp(ev(0, 0)));
  },
  async leave() {
    await act(async () => current().onPointerLeave());
  },
  setOrigin(o) {
    origin = o;
  },
};

describe('拖节点:命中就拖那一个,没命中就交给相机平移', () => {
  it('命中节点:只挪它(屏幕位移 / k),别的节点与相机都不动', async () => {
    await step.mount();
    await step.down(0, 0);
    await step.move(40, 20);
    expect(step.api().draggingId).toBe(1);
    expect(step.api().points.get(1)).toEqual({ x: 20, y: 10 });
    expect(step.api().points.get(2)).toEqual({ x: 100, y: 0 }); // 另一个节点一点没动
    expect(pan.onPointerDown).not.toHaveBeenCalled(); // 命中节点不进相机平移
    expect(pan.onPointerMove).not.toHaveBeenCalled(); // 拖节点时画面一下都不平移
  });

  it('没命中空白:整件事转交相机,节点坐标不变', async () => {
    await step.mount();
    await step.down(300, 300);
    await step.move(320, 300);
    expect(pan.onPointerDown).toHaveBeenCalledTimes(1);
    expect(pan.onPointerMove).toHaveBeenCalledTimes(1);
    expect(step.api().draggingId).toBeNull();
    expect(step.api().points).toBe(BASE); // 覆盖层没被建立
    expect(step.api().points.get(1)).toEqual({ x: 0, y: 0 });
  });

  it('容器有视口原点偏置时命中仍对得上(命中吃 client - origin)', async () => {
    await step.mount();
    step.setOrigin({ x: 292.5, y: 44 });
    // client(100,0) 减原点 = 画布 (-192.5,-44):空白。不减原点就是节点 2 的圆心,这条立刻红
    await step.down(100, 0);
    expect(step.api().draggingId).toBeNull();
    expect(pan.onPointerDown).toHaveBeenCalledTimes(1);
    await step.up();
    await step.down(492.5, 44); // 减原点 = 画布 (200,0):k=2 下节点 2 的世界 (100,0) 就画在这
    expect(step.api().draggingId).toBe(2);
    expect(pan.onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('右键命中节点不开拖节点(右键留给标签菜单);空白右键照旧交给相机', async () => {
    await step.mount();
    await step.down(0, 0, { button: 2 });
    expect(step.api().draggingId).toBeNull();
    expect(pan.onPointerDown).not.toHaveBeenCalled();
    await step.down(300, 300, { button: 2 });
    expect(pan.onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('按下即按 pointerId 捕获指针(拖出容器也收得到 move)', async () => {
    await step.mount();
    await step.down(0, 0);
    expect(capture.set).toHaveBeenCalledWith(7);
  });
});

describe('拖节点:松手落地', () => {
  it('松手:落点交给相机的写回,覆盖层撤掉,指针捕获释放', async () => {
    await step.mount();
    await step.down(0, 0);
    await step.move(40, 20);
    await step.up();
    expect(pan.commitPositions).toHaveBeenCalledWith({ 1: { x: 20, y: 10 } });
    expect(step.api().draggingId).toBeNull();
    expect(step.api().points).toBe(BASE); // 位置改由相机那份(已含写回)接管
    expect(capture.release).toHaveBeenCalledWith(7);
    expect(pan.onPointerUp).toHaveBeenCalled(); // 相机的平移态也要清
  });

  it('点一下没移动:不写回(单纯的选中不该留下位置)', async () => {
    await step.mount();
    await step.down(0, 0);
    await step.move(0, 0);
    await step.up();
    expect(pan.commitPositions).not.toHaveBeenCalled();
  });

  it('指针拖出容器(leave):这次移动照旧落地,相机平移态一并清掉', async () => {
    await step.mount();
    await step.down(0, 0);
    await step.move(10, 0);
    await step.leave();
    expect(pan.commitPositions).toHaveBeenCalledWith({ 1: { x: 5, y: 0 } });
    expect(step.api().draggingId).toBeNull();
    expect(pan.onPointerUp).toHaveBeenCalled();
  });
});

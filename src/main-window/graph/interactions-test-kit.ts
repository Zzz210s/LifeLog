// @vitest-environment jsdom
/**
 * `useGraphInteractions` 用例的共享测试件(仅测试引用,不进应用代码):
 * 夹具(两个节点 + 相机 + 可变的容器原点)、回调记数、挂载与事件发送。
 * 抽出来的理由与 canvas-test-kit.ts 一样 —— 命中换算的坐标算式只该有一份,
 * 用例文件再抄一遍会在改夹具时悄悄漂移(2026-09-30 终审修复轮:文件已到 200 行红线)。
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';
import type { GraphNode } from '../../shared/types';
import type { Point } from './radial';
import { useGraphInteractions, type GraphInteractions } from './use-graph-interactions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const NODES: GraphNode[] = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 4, selfCount: 0, sortOrder: 0 },
  { id: 2, path: '甲/一', depth: 2, parent: 1, notes: 1, selfCount: 1, sortOrder: 0 },
];
/** 节点 1 落在 (200,150)、节点 2 落在 (300,150);半径 r(4) = 3 + 容差 4 -> 圆心 7px 内算命中 */
export const POINTS: Map<number, Point> = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 100, y: 0 }],
]);
export const CAM = { k: 1, tx: 200, ty: 150 };

export interface InteractionsHarness {
  /** 当前挂载的 hook 返回值(未挂载就取会抛) */
  api: () => GraphInteractions;
  /** 回调记数:选中 / 展开 / 右键菜单落点 / 退出(双击空白) */
  calls: { select: (number | null)[]; expand: number[]; menu: number[][]; exit: number };
  /** 换容器原点(默认 (0,0) = 容器贴视口原点) */
  setOrigin(o: Point): void;
  mount(): Promise<void>;
  move(x: number, y: number, target?: EventTarget): Promise<void>;
  /** 指针抬离容器(onPointerLeave) */
  leave(): Promise<void>;
  click(x: number, y: number, target?: EventTarget): Promise<void>;
  doubleClick(x: number, y: number, target?: EventTarget): Promise<void>;
  /** 右键:返回 preventDefault 替身(用于断言浏览器菜单被拦下) */
  contextMenu(x: number, y: number, target?: EventTarget): Promise<() => void>;
  /** 卸载、还原替身(每次用例后调) */
  cleanup(): void;
}

export function makeInteractions(): InteractionsHarness {
  let origin: Point = { x: 0, y: 0 };
  let api: GraphInteractions | null = null;
  const calls = { select: [] as (number | null)[], expand: [] as number[], menu: [] as number[][], exit: 0 };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  function Harness(): null {
    api = useGraphInteractions({
      nodes: NODES,
      points: POINTS,
      cam: CAM,
      origin: () => origin,
      onSelect: (id) => calls.select.push(id),
      onExpand: (id) => calls.expand.push(id),
      onMenu: (id, x, y) => calls.menu.push([id, x, y]),
      onExit: () => {
        calls.exit++;
      },
    });
    return null;
  }

  const current = (): GraphInteractions => {
    if (api === null) throw new Error('先 await h.mount() 再用 h.api()');
    return api;
  };

  return {
    api: current,
    calls,
    setOrigin(o) {
      origin = o;
    },
    async mount() {
      await act(async () => {
        root.render(createElement(Harness));
      });
    },
    async move(x, y, target) {
      await act(async () => {
        current().onPointerMove({ clientX: x, clientY: y, target });
      });
    },
    async click(x, y, target) {
      await act(async () => {
        current().onClick({ clientX: x, clientY: y, target });
      });
    },
    async doubleClick(x, y, target) {
      await act(async () => {
        current().onDoubleClick({ clientX: x, clientY: y, target });
      });
    },
    async leave() {
      await act(async () => {
        current().onPointerLeave();
      });
    },
    async contextMenu(x, y, target) {
      const preventDefault = vi.fn();
      await act(async () => {
        current().onContextMenu({ clientX: x, clientY: y, target, preventDefault });
      });
      return preventDefault;
    },
    cleanup() {
      act(() => root.unmount());
      host.remove();
      vi.restoreAllMocks();
    },
  };
}

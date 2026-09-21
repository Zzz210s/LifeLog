/**
 * 拖拽期间的运行时副作用(自 use-tag-drag 拆出以守 200 行上限):
 * T1 边缘自动滚动(35px 带、0.3×越界夹 ±14px/帧、指针静止 1000ms 停)、
 * 滚动或展开后按当前指针位置回投 dragover 重算落点、T2 悬停 500ms 自动展开。
 * 指针与 DataTransfer 存在这里,帧循环与计时器都在本 hook 内部管理(卸载即清)。
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createDragAutoscroll } from './drag-autoscroll';
import type { DragAutoscroll } from './drag-autoscroll';
import type { TagNode } from './tag-tree';

export interface DragRuntimeOptions {
  /** 标签列表滚动容器 */
  listRef: RefObject<HTMLDivElement | null>;
  /** 拖拽是否仍在进行(帧循环据此继续) */
  active: () => boolean;
  /** 展开判定(已展开的节点不排自动展开) */
  expanded: (path: string) => boolean;
  /** 自动展开入口(只展开不收起) */
  onAutoExpand: (path: string) => void;
}

export interface DragRuntime {
  /** 记录指针位置并确保帧循环在跑;合成回投不刷新"指针静止"计时 */
  pointer(e: { clientX: number; clientY: number; dataTransfer: DataTransfer }): void;
  /** 滚动/展开后按当前指针位置重算落点:把 dragover 回投给指针下的元素 */
  recheck(): void;
  /** 悬停折叠且有子级的行:500ms 后展开(同一节点不重计时) */
  maybeAutoExpand(node: TagNode): void;
  /** 取消自动展开计时(离开/落点作废/拖拽结束) */
  cancelAuto(): void;
  /** 停帧循环 + 复位计时(dragend / 离开列表 / drop) */
  reset(): void;
}

/** 悬停自动展开的等待时长(ms,VS Code abstractTree 同值) */
const AUTO_EXPAND_MS = 500;

export function useDragRuntime(o: DragRuntimeOptions): DragRuntime {
  const dtRef = useRef<DataTransfer | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const synthetic = useRef(false);
  const autoTimer = useRef<number | null>(null);
  const autoPath = useRef<string | null>(null);
  const recheckRef = useRef<() => void>(() => {});
  const scrollRef = useRef<DragAutoscroll | null>(null);
  if (scrollRef.current === null) {
    scrollRef.current = createDragAutoscroll({
      scroller: () => o.listRef.current,
      active: () => o.active(),
      recheck: () => recheckRef.current(),
    });
  }

  const cancelAuto = (): void => {
    if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
    autoTimer.current = null;
    autoPath.current = null;
  };

  const recheck = (): void => {
    const dt = dtRef.current;
    if (!dt || !o.active()) return;
    const el = document.elementFromPoint(point.current.x, point.current.y);
    if (!el) return;
    synthetic.current = true;
    try {
      el.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: point.current.x,
          clientY: point.current.y,
        })
      );
    } finally {
      synthetic.current = false;
    }
  };
  recheckRef.current = recheck;

  const pointer: DragRuntime['pointer'] = (e) => {
    dtRef.current = e.dataTransfer;
    if (synthetic.current) return; // 回投事件不刷新静止计时,否则自动滚动永不停止
    point.current = { x: e.clientX, y: e.clientY };
    scrollRef.current?.pointer(e.clientY, false);
  };

  const maybeAutoExpand = (node: TagNode): void => {
    if (node.children.length === 0 || o.expanded(node.path)) {
      cancelAuto();
      return;
    }
    if (autoPath.current === node.path) return;
    cancelAuto();
    autoPath.current = node.path;
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = null;
      autoPath.current = null;
      o.onAutoExpand(node.path);
      // 展开后行位置变了:下一帧按当前位置重算落点
      window.requestAnimationFrame(() => recheckRef.current());
    }, AUTO_EXPAND_MS);
  };

  const reset = (): void => {
    cancelAuto();
    scrollRef.current?.stop();
    dtRef.current = null;
  };

  useEffect(() => () => reset(), []);
  return { pointer, recheck, maybeAutoExpand, cancelAuto, reset };
}

/**
 * 拖节点 + 位置记忆的接线(G3 Task 3):容器指针事件的**总入口**。
 *
 * **分工**(设计 §5 的"拖节点"与"拖空白平移"互斥):`onPointerDown` 先 `hitTest` ——
 * 命中节点就进入拖节点(`draggingId` + 指针捕获),**并且不再向下转交**给相机;
 * 没命中就把整件事交给相机(拖空白平移画布)。拖节点时 `onPointerMove` 也不转交,
 * 所以画面不会一边挪节点一边平移。
 *
 * 拖的是**被拖的那一个**节点:屏幕位移 / `cam.k` = 世界位移,只改它的坐标,不重算布局。
 * 松手把落点交给相机的 `commitPositions`(本地立刻生效 + 落库),因此本 hook 的覆盖层
 * 只管"手还按着"的那一段 —— 松开后位置由相机那份落点接管,不会闪回原位。
 * 指针捕获用 `typeof` 守卫:jsdom 没有 `setPointerCapture`,只有真机有。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../shared/types';
import { hitTest } from './graph-hit';
import { applyPositions } from './graph-positions';
import type { Point } from './radial';
import type { GraphCameraApi } from './use-graph-camera';

/** 事件只需要这几个字段:原生 PointerEvent 与 React 合成事件都满足 */
export interface NodeDragPointer {
  clientX: number;
  clientY: number;
  /** 0 主键 / 2 右键;合成事件与旧调用可省 —— 省了就按主键处理 */
  button?: number;
  pointerId?: number;
  currentTarget?: EventTarget | null;
}

export interface NodeDragApi {
  /** 正在拖的节点 id(null = 没在拖) */
  draggingId: number | null;
  /** 画布落点:相机那份(布局 + 库里的记忆)+ 拖拽中的实时位置;没在拖时就是相机那份(引用不变) */
  points: Map<number, Point>;
  onPointerDown: (e: NodeDragPointer) => void;
  onPointerMove: (e: NodeDragPointer) => void;
  onPointerUp: (e?: NodeDragPointer) => void;
  /** 指针离开容器 = 松手(拖拽中离开也要把这次移动落地,不能白拖) */
  onPointerLeave: (e?: NodeDragPointer) => void;
}

/** 一次拖拽的现场:起点的屏幕坐标与世界坐标(世界位移 = 屏幕位移 / k) */
interface Session {
  id: number;
  fromX: number;
  fromY: number;
  origin: Point;
  at: Point;
  moved: boolean;
}

type CaptureTarget = Element & {
  setPointerCapture?: (id: number) => void;
  releasePointerCapture?: (id: number) => void;
};

export function useNodeDrag(input: {
  nodes: readonly GraphNode[];
  /** 相机层:落点、当前 k、空白平移三步、以及松手写回 */
  cam: GraphCameraApi;
  /** 容器左上角的视口位置(指针带的是 client 坐标,命中要换算成画布局部坐标) */
  origin: () => Point;
}): NodeDragApi {
  const { nodes, cam, origin } = input;
  const { points: base, camera, commitPositions } = cam;
  const { onPointerDown: panDown, onPointerMove: panMove, onPointerUp: panUp } = cam;
  const k = camera.k;
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [live, setLive] = useState<Point | null>(null);
  const session = useRef<Session | null>(null);

  const onPointerDown = useCallback(
    (e: NodeDragPointer): void => {
      const o = origin();
      const id = hitTest({ nodes, points: base, cam: camera, x: e.clientX - o.x, y: e.clientY - o.y });
      if (id === null) {
        panDown(e); // 没命中:拖空白平移整件事交给相机
        return;
      }
      if (e.button !== undefined && e.button !== 0) return; // 右键命中不开拖节点(右键留给标签菜单)
      const at = base.get(id);
      if (at === undefined) return; // 布局没覆盖这个点(等价于画不出来,也拖不动)
      session.current = { id, fromX: e.clientX, fromY: e.clientY, origin: at, at, moved: false };
      setDraggingId(id);
      const el = e.currentTarget as CaptureTarget | null;
      if (e.pointerId !== undefined && typeof el?.setPointerCapture === 'function') {
        el.setPointerCapture(e.pointerId);
      }
    },
    [nodes, base, camera, origin, panDown],
  );

  const onPointerMove = useCallback(
    (e: NodeDragPointer): void => {
      const s = session.current;
      if (s === null) {
        panMove(e); // 没在拖节点:照旧交给相机(没按下时它自己是空操作)
        return;
      }
      const at = { x: s.origin.x + (e.clientX - s.fromX) / k, y: s.origin.y + (e.clientY - s.fromY) / k };
      s.at = at;
      if (at.x === s.origin.x && at.y === s.origin.y) return; // 同一像素上的抖动不算移动
      s.moved = true;
      setLive(at);
    },
    [k, panMove],
  );

  /** 收尾:撤覆盖层、还指针、把这次移动写回(没移动过则什么都不写) */
  const finish = useCallback(
    (e?: NodeDragPointer): void => {
      const s = session.current;
      session.current = null;
      setDraggingId(null);
      setLive(null);
      if (s === null) return;
      const el = (e?.currentTarget ?? null) as CaptureTarget | null;
      if (e?.pointerId !== undefined && typeof el?.releasePointerCapture === 'function') {
        el.releasePointerCapture(e.pointerId);
      }
      if (s.moved) commitPositions({ [String(s.id)]: s.at });
    },
    [commitPositions],
  );

  const onPointerUp = useCallback(
    (e?: NodeDragPointer): void => {
      finish(e);
      panUp(); // 相机的平移态一并清掉(拖节点时它本来就是空的)
    },
    [finish, panUp],
  );

  const points = useMemo(
    () =>
      live === null || draggingId === null ? base : applyPositions(base, { [String(draggingId)]: live }),
    [base, draggingId, live],
  );

  return { draggingId, points, onPointerDown, onPointerMove, onPointerUp, onPointerLeave: onPointerUp };
}

/**
 * 图上的指针交互 -> 语义动作(G2 Task 5):悬停 / 单击选中 / 双击展开(空白则回信息流)/ 右键标签菜单。
 *
 * **坐标口径**:`points` 与 `cam` 是**画布局部**坐标(与 `GraphCanvas` 的绘制坐标系同一套),
 * 而指针事件带的是 client(视口)坐标,故用 `origin()`(容器左上角的视口位置)换算:
 * 命中检测吃 `client - origin`,气泡锚点吃 `画布坐标 + origin`(`TipBubble` 是 `fixed` 定位,要吃视口坐标)。
 * 本视图左边有侧栏、上边有顶栏,容器不在视口原点 —— 不换算就会整体点偏一个容器原点。
 *
 * **覆盖层**:右侧信息条与标签菜单压在画布上,它们的事件目标带 `data-graph-overlay`,
 * 一律不当画布交互处理(否则点「展开笔记」的同一个 click 会先冒泡到画布、把选中清掉,信息条当场消失)。
 *
 * **`+N`**:展开层被略去的那些笔记的提示位画在**标签环外偏下**(`noteFan` 的 `OVERFLOW_GAP`),
 * 单击优先判它(`+N` -> 带着该标签回信息流,与点笔记小圆同一口径);悬停 / 双击 / 右键都不看它 ——
 * 看了就会把展开后的「再双击收起」(设计 §5)吞掉。命中顺序仍放在节点之前:两层既然已经不重叠,
 * 这条顺序就只是"`+N` 先答"的稳定约定(将来若再挪位置也不会被节点吞掉)。
 *
 * 只在真的变了才 setState:悬停同一节点时移动鼠标不换 state,视图不重渲染、`plan` 不重建。
 */
import { useCallback, useState } from 'react';
import type { GraphNode } from '../../shared/types';
import { screenOf, type Camera } from './graph-camera';
import { hitTest } from './graph-hit';
import type { Point } from './radial';

/** 事件只需要这几个字段:原生事件与 React 合成事件都满足;`target` 可省(测试里手搓事件) */
export interface PointerAt {
  clientX: number;
  clientY: number;
  target?: EventTarget | null;
}

export interface GraphInteractions {
  /** 悬停命中的节点 id(null = 空白处) */
  hovered: number | null;
  /** 悬停节点的气泡锚点(视口坐标;`TipBubble` 是 fixed) */
  tipAt: Point | null;
  onPointerMove: (e: PointerAt) => void;
  onPointerLeave: () => void;
  onClick: (e: PointerAt) => void;
  onDoubleClick: (e: PointerAt) => void;
  onContextMenu: (e: PointerAt & { preventDefault: () => void }) => void;
}

/** 展开层的 `+N` 提示位:屏幕坐标 + 所属标签 id(它指示的那批笔记要从哪个标签筛过去) */
export interface OverflowHit {
  id: number;
  x: number;
  y: number;
}

/**
 * `+N` 的命中半径:提示位按 12px 画在标签环外偏下,给足一个字的宽度。
 * 取舍:单击落在这个圈里判 `+N`(回信息流),圈外才轮到标签点。它现在离标签点至少
 * `radiusOf(0) + FAN_GAP + OVERFLOW_GAP`(≈ 28px),所以小标签(笔记数 ≲150)的圆心也轮得到节点
 * (`2026-10-01 修`:此前提示位画在圆心,小标签整块被盖住)。再小够不着 `+N` 的字。
 */
export const OVERFLOW_REACH = 10;

/** 指针(视口坐标)是否落在 `+N` 上:先换成画布局部坐标,再比距离(与节点命中同一套原点换算) */
export function hitsOverflow(o: OverflowHit, e: PointerAt, origin: Point): boolean {
  return Math.hypot(o.x - (e.clientX - origin.x), o.y - (e.clientY - origin.y)) <= OVERFLOW_REACH;
}

/** 事件来自覆盖层(信息条 / 标签菜单)而不是画布 */
function fromOverlay(e: PointerAt): boolean {
  const t = e.target;
  return t instanceof Element && t.closest('[data-graph-overlay]') !== null;
}

/** 坐标没变就保持原对象(悬停同一节点时鼠标乱动不该换来一串重渲染) */
function samePoint(a: Point | null, b: Point | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}

export function useGraphInteractions(input: {
  nodes: readonly GraphNode[];
  points: Map<number, Point>;
  cam: Camera;
  /** 容器左上角的视口位置(每次事件现读:窗口移动、侧栏显隐之后也还得对) */
  origin: () => Point;
  /** 命中 -> 选中;未命中 -> 清选中(null) */
  onSelect: (id: number | null) => void;
  /** 双击命中(已展开则收起由上层的状态决定) */
  onExpand: (id: number) => void;
  /** 右键命中:菜单落点用事件的 client 坐标(钳制在上层做) */
  onMenu: (id: number, x: number, y: number) => void;
  /** 双击**空白** = 回信息流(设计 §5:双击节点是展开,双击空白是退出) */
  onExit: () => void;
  /** 展开层的 `+N`(屏幕坐标);没展开或没略去时给 null(缺省也是 null) */
  overflow?: OverflowHit | null;
  /** 命中 `+N`:与点笔记小圆同效 —— 带着该标签(id)回信息流 */
  onOverflow?: (id: number) => void;
}): GraphInteractions {
  const { nodes, points, cam, origin, onSelect, onExpand, onMenu, onExit } = input;
  const overflow = input.overflow ?? null;
  const onOverflow = input.onOverflow;
  const [hovered, setHovered] = useState<number | null>(null);
  const [tipAt, setTipAt] = useState<Point | null>(null);

  /** 一次算出「命中的节点」与「本次的容器原点」:气泡与命中必须同一份原点 */
  const pick = useCallback(
    (e: PointerAt): { id: number | null; origin: Point } => {
      const o = origin();
      const id = hitTest({ nodes, points, cam, x: e.clientX - o.x, y: e.clientY - o.y });
      return { id, origin: o };
    },
    [nodes, points, cam, origin],
  );

  const onPointerMove = useCallback(
    (e: PointerAt): void => {
      if (fromOverlay(e)) {
        setHovered(null);
        setTipAt(null);
        return;
      }
      const { id, origin: o } = pick(e);
      setHovered((h) => (h === id ? h : id));
      const p = id === null ? undefined : points.get(id);
      const s = p === undefined ? null : screenOf(p, cam);
      const next = s === null ? null : { x: s.x + o.x, y: s.y + o.y };
      setTipAt((t) => (samePoint(t, next) ? t : next));
    },
    [pick, points, cam],
  );

  const onPointerLeave = useCallback((): void => {
    setHovered(null);
    setTipAt(null);
  }, []);

  const onClick = useCallback(
    (e: PointerAt): void => {
      if (fromOverlay(e)) return;
      const { id, origin: o } = pick(e);
      // `+N` 画在环外偏下:先判它(命中顺序与画出来的两层一致,且它离得近时先答"还有 N 条")
      if (overflow !== null && hitsOverflow(overflow, e, o)) {
        onOverflow?.(overflow.id);
        return;
      }
      onSelect(id);
    },
    [pick, onSelect, overflow, onOverflow],
  );

  const onDoubleClick = useCallback(
    (e: PointerAt): void => {
      if (fromOverlay(e)) return;
      const { id } = pick(e);
      if (id === null) onExit();
      else onExpand(id);
    },
    [pick, onExpand, onExit],
  );

  const onContextMenu = useCallback(
    (e: PointerAt & { preventDefault: () => void }): void => {
      e.preventDefault(); // 右键要开标签菜单,不弹浏览器菜单
      if (fromOverlay(e)) return;
      const { id } = pick(e);
      if (id !== null) onMenu(id, e.clientX, e.clientY);
    },
    [pick, onMenu],
  );

  return { hovered, tipAt, onPointerMove, onPointerLeave, onClick, onDoubleClick, onContextMenu };
}

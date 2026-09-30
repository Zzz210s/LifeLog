/**
 * 相机状态 + 交互(G1):滚轮以光标为中心缩放、拖空白平移(只认主键,G2)、`0` 复位、`+`/`-` 以画布中心缩放。
 * 位置记忆:进视图读一次 settings `graph_positions`(只含被拖过的节点),叠加在布局结果之上;
 * 写回只发生在 savePositions 被调用时(G1 不做节点拖拽,G2 接)。
 * 键盘监听与视图外壳的 `Esc` 退出是两条独立监听:这里只管缩放三键,不 stopPropagation,互不吞。
 * 键盘缩放按设计 §5 的 `+` `-` `0`:画布没有"光标位置"可用,锚点取画布中心(`=` 是 `+` 的无 Shift 键位)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { fitToView, zoomAt, type Camera } from './graph-camera';
import type { Point } from './radial';

export const GRAPH_POSITIONS_KEY = 'graph_positions';
/** 每格滚轮的缩放倍率(相机用例与视图接线用例共读这一份,别在测试里抄第二份) */
export const ZOOM_STEP = 1.15;
const NO_SAVED: Map<number, Point> = new Map();
/** 默认的"没有坐标系偏移":画布贴视口原点时 client 与画布局部坐标是同一套 */
const NO_ORIGIN = (): Point => ({ x: 0, y: 0 });

/** 解析记忆位置:坏 JSON / 非对象 / 坐标非有限数的条目一律丢弃(脏数据不该让整图落不了位) */
export function parseGraphPositions(raw: string | null): Map<number, Point> {
  const out = new Map<number, Point>();
  if (raw === null || raw.trim() === '') return out;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const id = Number(key);
    const p = value as { x?: unknown; y?: unknown } | null;
    if (!Number.isInteger(id) || typeof p?.x !== 'number' || typeof p.y !== 'number') continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    out.set(id, { x: p.x, y: p.y });
  }
  return out;
}

/**
 * 叠加:记忆位置只覆盖"已被拖过、且这次布局里存在"的节点;不改原 Map。
 * 没有任何记忆时原样返回布局结果(Map 身份不变 -> 下游 plan 的 memo 不白重建)。
 */
export function overlayPositions(
  points: Map<number, Point>,
  saved: Map<number, Point>,
): Map<number, Point> {
  if (saved.size === 0) return points;
  const out = new Map(points);
  for (const [id, p] of saved) if (out.has(id)) out.set(id, p);
  return out;
}

/** 拖拽只需要这几个字段:原生 PointerEvent 与 React 合成事件都满足 */
export interface PointerAt {
  clientX: number;
  clientY: number;
  /** 按键(0 主键 / 2 右键);合成事件与旧调用可省 —— 省了就按主键处理 */
  button?: number;
}

export interface GraphCameraApi {
  camera: Camera;
  /** 叠加过记忆位置的落点(布局结果 + graph_positions):绘制与适配都用它 */
  points: Map<number, Point>;
  reset: () => void;
  /** 把某个世界点在**不改缩放**的前提下摆到画布中心(G2 的图内搜索跳转用) */
  centerOn: (p: Point) => void;
  onWheel: (e: WheelEvent) => void;
  onPointerDown: (e: PointerAt) => void;
  onPointerMove: (e: PointerAt) => void;
  onPointerUp: () => void;
  /** 位置记忆写回:只写拖过的那些,与库中已有条目合并 */
  savePositions: (moved: Record<string, Point>) => Promise<void>;
}

export function useGraphCamera(opts: {
  width: number;
  height: number;
  points: Map<number, Point>;
  /**
   * 容器左上角的**视口**位置:滚轮的 `clientX/Y` 是视口坐标,而 `zoomAt` 要的是画布局部坐标。
   * 本视图左边有侧栏、上边有顶栏,容器不在视口原点 —— 不换算,缩放的锚点会整体偏一个容器原点
   * (真机实测:滚轮打在画布中心时,反解出的不动点离正确口径偏 295px)。默认恒等原点。
   */
  origin?: () => Point;
}): GraphCameraApi {
  const [camera, setCamera] = useState<Camera>({ k: 1, tx: opts.width / 2, ty: opts.height / 2 });
  const [saved, setSaved] = useState<Map<number, Point>>(NO_SAVED);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const origin = opts.origin ?? NO_ORIGIN;

  // 位置记忆只读一次;卸载后迟到的回包不碰状态
  useEffect(() => {
    let alive = true;
    void api.getSetting(GRAPH_POSITIONS_KEY).then(
      (raw) => {
        if (alive) setSaved(parseGraphPositions(raw));
      },
      () => undefined, // 读不到就用布局坐标,不打扰用户
    );
    return () => {
      alive = false;
    };
  }, []);

  const points = useMemo(() => overlayPositions(opts.points, saved), [opts.points, saved]);

  const reset = useCallback((): void => {
    setCamera(fitToView([...points.values()], opts.width, opts.height));
  }, [points, opts.width, opts.height]);

  // 只挪平移量,不动 k:搜索跳转不该顺带改变用户当前的缩放档(反向解 screenOf:k 不变时
  // tx = 中心 x - p.x * k 就能把 p 摆到画布中心)
  const centerOn = useCallback(
    (p: Point): void => {
      setCamera((cam) => ({
        k: cam.k,
        tx: opts.width / 2 - p.x * cam.k,
        ty: opts.height / 2 - p.y * cam.k,
      }));
    },
    [opts.width, opts.height],
  );

  const zoomBy = useCallback(
    (factor: number): void => {
      setCamera((cam) => zoomAt(cam, factor, { x: opts.width / 2, y: opts.height / 2 }));
    },
    [opts.width, opts.height],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 输入法组合中(打拼音时 `-` 也会作为按键冒上来)不处理:这不是快捷键
      if (e.isComposing || e.keyCode === 229) return;
      // 焦点在输入框/可编辑区:用户在打字而不是按图快捷键。
      // 缺这条时 G2 的图内搜索框里打 `-`/`+` 会同时缩放画布(G1 审查点名的真 bug)。
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, [contenteditable]')) return;
      // 带修饰键的按键(Ctrl+0 等)留给宿主,不抢
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '0') reset();
      else if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP);
      else if (e.key === '-') zoomBy(1 / ZOOM_STEP);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reset, zoomBy]);

  const onWheel = useCallback((e: WheelEvent): void => {
    e.preventDefault();
    const o = origin();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setCamera((cam) => zoomAt(cam, factor, { x: e.clientX - o.x, y: e.clientY - o.y }));
  }, [origin]);

  const onPointerDown = useCallback((e: PointerAt): void => {
    // 只认主键:右键的按下不进入拖拽(右键是开标签菜单,G2),后续 pointermove 因 drag 为空而不平移
    if (e.button !== undefined && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: PointerAt): void => {
    const from = drag.current;
    if (from === null) return;
    drag.current = { x: e.clientX, y: e.clientY };
    setCamera((cam) => ({
      ...cam,
      tx: cam.tx + (e.clientX - from.x),
      ty: cam.ty + (e.clientY - from.y),
    }));
  }, []);

  const onPointerUp = useCallback((): void => {
    drag.current = null;
  }, []);

  const savePositions = useCallback(async (moved: Record<string, Point>): Promise<void> => {
    const merged = parseGraphPositions(await api.getSetting(GRAPH_POSITIONS_KEY));
    for (const [id, p] of parseGraphPositions(JSON.stringify(moved))) merged.set(id, p);
    await api.setSetting(GRAPH_POSITIONS_KEY, JSON.stringify(Object.fromEntries(merged)));
  }, []);

  return { camera, points, reset, centerOn, onWheel, onPointerDown, onPointerMove, onPointerUp, savePositions };
}

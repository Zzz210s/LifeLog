/**
 * 相机状态 + 交互(G1):滚轮以光标为中心缩放、拖空白平移(只认主键,G2)、`0` 复位、`+`/`-` 以画布中心缩放。
 * 位置记忆:进视图读一次 settings `graph_positions`(只含被拖过的节点),叠加在布局结果之上;
 * 写回是 `commitPositions`(G3 起唯一调用方是拖节点):先本地生效(松手不闪回),再"读旧值 -> 合并 -> 修剪 -> 写回"串行落库。
 * 键盘监听与视图外壳的 `Esc` 退出是两条独立监听:这里只管缩放三键,不 stopPropagation,互不吞。
 * 键盘缩放按设计 §5 的 `+` `-` `0`:画布没有"光标位置"可用,锚点取画布中心(`=` 是 `+` 的无 Shift 键位)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { fitToView, zoomAt, type Camera } from './graph-camera';
import { applyPositions, parsePositions, prunePositions, serializePositions, NO_POSITIONS, type Positions } from './graph-positions';
import type { Point } from './radial';

export const GRAPH_POSITIONS_KEY = 'graph_positions';
/** 每格滚轮的缩放倍率(相机用例与视图接线用例共读这一份,别在测试里抄第二份) */
export const ZOOM_STEP = 1.15;
/** 默认的"没有坐标系偏移":画布贴视口原点时 client 与画布局部坐标是同一套 */
const NO_ORIGIN = (): Point => ({ x: 0, y: 0 });
/** 缺省修剪口径:调用方没给现存标签集时一个条目都不删 */
const NO_IDS: Set<number> = new Set();

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
  /** 库里有位置记忆的标签(= 被拖过的节点):「整理布局」拿它当锚点,不移动这些点 */
  pinned: ReadonlySet<number>;
  reset: () => void;
  /** 把某个世界点在**不改缩放**的前提下摆到画布中心(G2 的图内搜索跳转用) */
  centerOn: (p: Point) => void;
  /**
   * 以**指定屏幕点**为锚点缩放(2026-10-04):聚合圆放大需要"放大到那个圆",
   * 而 `zoomBy` 锚在画布中心、合成 WheelEvent 的坐标又是 0(左上角)。
   */
  zoomAtScreen: (p: Point, factor: number) => void;
  onWheel: (e: WheelEvent) => void;
  onPointerDown: (e: PointerAt) => void;
  onPointerMove: (e: PointerAt) => void;
  onPointerUp: () => void;
  /** 位置记忆写回(只由拖节点调用):本地立刻生效,再按现存标签修剪后落库 */
  commitPositions: (moved: Positions) => void;
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
  /** 写回时的"现存标签 id":库里已删的标签不再保留位置;缺省表示不修剪 */
  validIds?: Set<number>;
  /**
   * 「重置视图」的适配信号(单调递增;缺省 0 = 没人请求过):变了就在**当次渲染**的落点上重新适配
   * —— 与内置 `reset` 同一份算式。用信号而不是回调:相机先于力导向建立,而复位要作废整理结果(在上游),
   * 回调会绕回相机自己;信号由 `useGraphStage` 递增,下一帧生效时落点已是径向布局。
   */
  resetSignal?: number;
  /**
   * 按 `0` 时改走这一份(缺省:内置的 `reset`)。「重置视图」= 作废整理结果 + 适配相机,而整理结果在上层,
   * 合成动作只能由上层给。它**不负责适配**:适配一律走 `resetSignal`(下一帧按新落点算),
   * 否则会拿整理前的落点去适配。
   */
  onReset?: () => void;
}): GraphCameraApi {
  const [camera, setCamera] = useState<Camera>({ k: 1, tx: opts.width / 2, ty: opts.height / 2 });
  const [saved, setSaved] = useState<Positions>(NO_POSITIONS);
  const savedRef = useRef<Positions>(NO_POSITIONS);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const drag = useRef<{ x: number; y: number } | null>(null);
  const origin = opts.origin ?? NO_ORIGIN;
  const validIds = opts.validIds ?? NO_IDS;
  const onReset = opts.onReset;

  // 位置记忆只读一次;卸载后迟到的回包不碰状态
  useEffect(() => {
    let alive = true;
    void api.getSetting(GRAPH_POSITIONS_KEY).then(
      (raw) => {
        if (!alive) return;
        const parsed = parsePositions(raw);
        savedRef.current = parsed;
        setSaved(parsed);
      },
      () => undefined, // 读不到就用布局坐标,不打扰用户
    );
    return () => {
      alive = false;
    };
  }, []);

  const points = useMemo(() => applyPositions(opts.points, saved), [opts.points, saved]);
  // 被拖过的节点 = 位置记忆里的那些 key(写回只有拖节点一个入口,所以这份集合不会混进别的东西)
  const pinned = useMemo(() => new Set(Object.keys(saved).map(Number)), [saved]);

  const reset = useCallback((): void => {
    setCamera(fitToView([...points.values()], opts.width, opts.height));
  }, [points, opts.width, opts.height]);

  // 「重置视图」的适配:信号一变就重新适配。`fitted` 记住已处理的信号 ——
  // 只盯 `reset` 的身份不行:尺寸/落点一变它就换引用,那样拖节点或改尺寸都会把用户的缩放/平移冲掉。
  const signal = opts.resetSignal ?? 0;
  const fitted = useRef(signal);
  useEffect(() => {
    if (fitted.current === signal) return;
    fitted.current = signal;
    reset();
  }, [signal, reset]);

  const commitPositions = useCallback(
    (moved: Positions): void => {
      // 先本地落地:库的回包还没到,松手也不能闪回原位(React 同批渲染,画面只跳一次)
      const next = { ...savedRef.current, ...moved };
      savedRef.current = next;
      setSaved(next);
      // 写回以库为准(别的会话可能也写过):读旧值 -> 与本地已知位置合并 -> 按现存标签修剪 -> 写回。
      // 修剪只在写的时候做:本地那份可能留着已删标签的条目,但落点表里没有它,画不出来也不会被写回。
      // 串行链:两次拖拽挨得近时,后一次必须读到前一次写进去的值,否则互相覆盖。
      writes.current = writes.current
        .then(async () => {
          const old = parsePositions(await api.getSetting(GRAPH_POSITIONS_KEY));
          const merged = prunePositions({ ...old, ...savedRef.current }, validIds);
          await api.setSetting(GRAPH_POSITIONS_KEY, serializePositions(merged));
        })
        .catch(() => undefined); // 写失败不打扰用户:本次会话的位置已经在画面上生效
    },
    [validIds],
  );

  // 只挪平移量,不动 k:搜索跳转不该顺带改变用户的缩放档(反向解 screenOf:tx = 中心 x - p.x * k)
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

  const zoomAtScreen = useCallback((p: Point, factor: number): void => {
    setCamera((cam) => zoomAt(cam, factor, p));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 输入法组合中(打拼音时 `-` 也会作为按键冒上来)不处理:这不是快捷键
      if (e.isComposing || e.keyCode === 229) return;
      // 焦点在输入框/可编辑区是打字,不是图快捷键(缺这条:图内搜索框里打 `-`/`+` 会同时缩放画布)
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, [contenteditable]')) return;
      // 带修饰键的按键(Ctrl+0 等)留给宿主,不抢
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '0') (onReset ?? reset)();
      else if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP);
      else if (e.key === '-') zoomBy(1 / ZOOM_STEP);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reset, zoomBy, onReset]);

  const onWheel = useCallback((e: WheelEvent): void => {
    e.preventDefault();
    const o = origin();
    // 锚点吃**画布局部**坐标:`clientX/Y` 减容器原点(容器左边有侧栏、上边有顶栏)。
    // 这条 G2 就已修好(91b2a5c9),不是欠账 —— 早期报告里的"仍是 client 口径"是旧话。
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
    setCamera((cam) => ({ ...cam, tx: cam.tx + (e.clientX - from.x), ty: cam.ty + (e.clientY - from.y) }));
  }, []);

  const onPointerUp = useCallback((): void => {
    drag.current = null;
  }, []);

  return {
    camera, points, pinned, reset, centerOn, zoomAtScreen,
    onWheel, onPointerDown, onPointerMove, onPointerUp, commitPositions,
  };
}

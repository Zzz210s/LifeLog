/**
 * 相机的输入层(自 `use-graph-camera.ts` 抽出):滚轮以光标为中心缩放、拖空白平移(只认主键,G2)、
 * 键盘 `0` 复位与 `+`/`-` 以画布中心缩放,以及图内搜索用的 `centerOn`(不改缩放)。
 *
 * 键盘监听与视图外壳的 `Esc` 退出是两条独立监听:这里只管缩放三键,不 stopPropagation,互不吞。
 * 键盘缩放按设计 §5 的 `+` `-` `0`:画布没有"光标位置"可用,锚点取画布中心(`=` 是 `+` 的无 Shift 键位)。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { zoomAt, type Camera } from './graph-camera';
import { ZOOM_STEP, type PointerAt } from './graph-camera-api';
import type { Point } from './radial';

export function useGraphCameraInput(opts: {
  width: number;
  height: number;
  /** 容器左上角的**视口**位置(滚轮坐标换算是它,见 use-graph-origin) */
  origin: () => Point;
  /** 内置复位(`0` 键的缺省动作) */
  reset: () => void;
  /** `0` 键改走这一份(缺省:内置的 `reset`) */
  onReset?: () => void;
  setCamera: Dispatch<SetStateAction<Camera>>;
}): {
  centerOn: (p: Point) => void;
  zoomAtScreen: (p: Point, factor: number) => void;
  onWheel: (e: WheelEvent) => void;
  onPointerDown: (e: PointerAt) => void;
  onPointerMove: (e: PointerAt) => void;
  onPointerUp: () => void;
} {
  const { width, height, origin, reset, onReset, setCamera } = opts;
  const drag = useRef<{ x: number; y: number } | null>(null);

  // 只挪平移量,不动 k:搜索跳转不该顺带改变用户的缩放档(反向解 screenOf:tx = 中心 x - p.x * k)
  const centerOn = useCallback(
    (p: Point): void => {
      setCamera((cam) => ({
        k: cam.k,
        tx: width / 2 - p.x * cam.k,
        ty: height / 2 - p.y * cam.k,
      }));
    },
    [width, height, setCamera],
  );

  const zoomBy = useCallback(
    (factor: number): void => {
      setCamera((cam) => zoomAt(cam, factor, { x: width / 2, y: height / 2 }));
    },
    [width, height, setCamera],
  );

  const zoomAtScreen = useCallback(
    (p: Point, factor: number): void => {
      setCamera((cam) => zoomAt(cam, factor, p));
    },
    [setCamera],
  );

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

  const onWheel = useCallback(
    (e: WheelEvent): void => {
      e.preventDefault();
      const o = origin();
      // 锚点吃**画布局部**坐标:`clientX/Y` 减容器原点(容器左边有侧栏、上边有顶栏)。
      // 这条 G2 就已修好(91b2a5c9),不是欠账 —— 早期报告里的"仍是 client 口径"是旧话。
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setCamera((cam) => zoomAt(cam, factor, { x: e.clientX - o.x, y: e.clientY - o.y }));
    },
    [origin, setCamera],
  );

  const onPointerDown = useCallback((e: PointerAt): void => {
    // 只认主键:右键的按下不进入拖拽(右键是开标签菜单,G2),后续 pointermove 因 drag 为空而不平移
    if (e.button !== undefined && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback(
    (e: PointerAt): void => {
      const from = drag.current;
      if (from === null) return;
      drag.current = { x: e.clientX, y: e.clientY };
      setCamera((cam) => ({
        ...cam,
        tx: cam.tx + (e.clientX - from.x),
        ty: cam.ty + (e.clientY - from.y),
      }));
    },
    [setCamera],
  );

  const onPointerUp = useCallback((): void => {
    drag.current = null;
  }, []);

  return { centerOn, zoomAtScreen, onWheel, onPointerDown, onPointerMove, onPointerUp };
}

/**
 * 相机状态 + 交互(G1)的入口:位置记忆在 `use-graph-camera-positions`,输入事件在
 * `use-graph-camera-input`,契约与常量在 `graph-camera-api`(2026-10-05 拆出,守 200 行红线)。
 * 本文件只摆顺序:读位置 -> 适配(复位信号)-> 输入监听。
 *
 * 「重置视图」与 `0` 的合成动作由上层给 `onReset`;`resetSignal` 一变就在**当次渲染**的落点上
 * 重新适配(与内置 `reset` 同一份算式),见下。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fitToView, type Camera } from './graph-camera';
import type { GraphCameraApi } from './graph-camera-api';
import { useGraphCameraInput } from './use-graph-camera-input';
import { useGraphCameraPositions } from './use-graph-camera-positions';
import type { Point } from './radial';

export { GRAPH_POSITIONS_KEY, ZOOM_STEP } from './graph-camera-api';
export type { GraphCameraApi, PointerAt } from './graph-camera-api';

/** 默认的"没有坐标系偏移":画布贴视口原点时 client 与画布局部坐标是同一套 */
const NO_ORIGIN = (): Point => ({ x: 0, y: 0 });

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
  const origin = opts.origin ?? NO_ORIGIN;

  const { points, pinned, commitPositions } = useGraphCameraPositions({
    points: opts.points,
    validIds: opts.validIds,
  });

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

  const input = useGraphCameraInput({
    width: opts.width,
    height: opts.height,
    origin,
    reset,
    onReset: opts.onReset,
    setCamera,
  });

  return {
    camera,
    points,
    pinned,
    reset,
    centerOn: input.centerOn,
    zoomAtScreen: input.zoomAtScreen,
    onWheel: input.onWheel,
    onPointerDown: input.onPointerDown,
    onPointerMove: input.onPointerMove,
    onPointerUp: input.onPointerUp,
    commitPositions,
  };
}

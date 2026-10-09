/**
 * 容器左上角的**视口**位置(G2 收 Task 5 的坐标口径):指针事件与滚轮带的是视口坐标,
 * 而画布与相机用的是容器局部坐标 —— 命中检测吃 `client - origin`、气泡锚点吃
 * `画布坐标 + origin`(`TipBubble` 是 `fixed`)。本视图左边有侧栏、上边有顶栏,容器不在视口原点。
 *
 * 为什么**每次现读**而不是缓存一次:`getBoundingClientRect` 会随窗口挪动、侧栏显隐、窗口缩放变,
 * 缓存住就会整体点偏;单次读是微秒级开销,指针事件的频率也远够用。
 *
 * 自 `GraphView` 抽出以守 200 行红线(与 use-graph-size / use-collapse-roots 同一处理):
 * 相机缩放锚点、指针交互、展开条目三处共读这一份。
 */
import { useCallback } from 'react';
import type { Point } from './radial';

export function useGraphOrigin<T extends HTMLElement>(boxRef: { readonly current: T | null }): () => Point {
  return useCallback((): Point => {
    const r = boxRef.current?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: r?.top ?? 0 };
  }, [boxRef]);
}

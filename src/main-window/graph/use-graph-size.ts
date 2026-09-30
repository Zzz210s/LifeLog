/**
 * 画布尺寸实测(G2 Task 5 自 `GraphView` 抽出,守行数红线):
 * 按容器读数取整(CSS 像素;亚像素宽高会让后备缓冲出现半像素模糊),
 * `ResizeObserver` 与 `window.resize` 都量;读数没变就保持原对象 ——
 * 白换一次会让 `plan` 重建、整图重绘(拖窗口会连发 resize)。
 */
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

export interface GraphSize {
  w: number;
  h: number;
}

export function useGraphSize(boxRef: RefObject<HTMLDivElement | null>): GraphSize {
  const [size, setSize] = useState<GraphSize>({ w: 0, h: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const measure = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(el.clientWidth * dpr) / dpr;
      const h = Math.round(el.clientHeight * dpr) / dpr;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    // jsdom 没有 ResizeObserver:没有它时只靠上面的首次测量与 window resize
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [boxRef]);

  return size;
}

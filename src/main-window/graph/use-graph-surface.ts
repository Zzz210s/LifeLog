/**
 * 画布容器上的两件 DOM 接线(G3 自 `GraphView` 抽出,守它的 200 行红线):
 * - 首次适配一次:落点与屏幕尺寸都就绪时适配视图(设计 §3.3),此后只由 `0` 复位 ——
 *   适配算式只有相机的 `reset` 一份,这里只决定"什么时候调用它"
 * - wheel 显式非被动:React 的 `onWheel` 挂在被动层,`preventDefault` 无效(页面跟着滚),只能 `addEventListener`
 * 两件都是"一次性挂上、随后由 React 状态驱动"的接线,与相机/拖节点的状态机无关。
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** 就绪后调用一次 `fit`(之后即使就绪状态变化也不再调用:相机此后归用户) */
export function useAutoFit(ready: boolean, fit: () => void): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready) return;
    done.current = true;
    fit();
  }, [ready, fit]);
}

/** 在 `ref` 上挂 `wheel`(passive: false);`onWheel` 换引用时重挂 */
export function usePassiveWheel(ref: RefObject<HTMLElement | null>, onWheel: (e: WheelEvent) => void): void {
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, onWheel]);
}

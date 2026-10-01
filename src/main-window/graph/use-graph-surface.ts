/**
 * 画布容器上的两件 DOM 接线(G3 自 `GraphView` 抽出,守它的 200 行红线):
 * - 首次适配一次:落点与屏幕尺寸都就绪时适配视图(设计 §3.3),此后只由 `0` 复位 ——
 *   适配算式只有相机的 `reset` 一份,这里只决定"什么时候调用它";就绪等不到时有**有界等待**
 *   (见 `AUTO_FIT_BUDGET_MS`):一次永不 settle 的 `getSetting` 不该把图卡在初始相机上
 * - wheel 显式非被动:React 的 `onWheel` 挂在被动层,`preventDefault` 无效(页面跟着滚),只能 `addEventListener`
 * 两件都是"一次性挂上、随后由 React 状态驱动"的接线,与相机/拖节点的状态机无关。
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * 首次适配的等待预算(ms):折叠根是异步读设置(IPC 理论上可能永不 settle),
 * 超过预算就按**当时**的落点适配一次 —— 兜底用未折叠的落点是有意的:比"图停在 k=1/tx=0/ty=0"好,
 * 用户按 `0` 就能回到折叠后的适配档。
 */
export const AUTO_FIT_BUDGET_MS = 1500;

/**
 * 就绪后调用一次 `fit`(之后即使就绪状态变化也不再调用:相机此后归用户);等不到就绪也有界等待:
 * 预算到点后照样适配一次。
 */
export function useAutoFit(ready: boolean, fit: () => void, budgetMs: number = AUTO_FIT_BUDGET_MS): void {
  const done = useRef(false);
  const latest = useRef(fit);
  // 定时器到点时要用**最新**那份 `fit`(尺寸/落点变了它换引用);写 ref 放在 effect 里,不在渲染期写
  useEffect(() => {
    latest.current = fit;
  }, [fit]);

  useEffect(() => {
    if (done.current) return;
    if (ready) {
      done.current = true;
      latest.current();
      return;
    }
    const t = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      latest.current();
    }, budgetMs);
    return () => clearTimeout(t);
  }, [ready, budgetMs]);
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

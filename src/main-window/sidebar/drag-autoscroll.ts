/**
 * 标签拖拽的边缘自动滚动(T1,按 VS Code listView 数值)。
 * 触发带 35px(上缘 35px 内、下缘 clientHeight-35 内),速度 = 0.3 × 越界量,每帧夹在 ±14px;
 * rAF 驱动;**指针静止 1000ms 停止**;dragend/drop/离开列表立即停。
 * 滚动过程中指针下方的行变了,故每帧滚动后调 recheck() 按当前位置重算落点(合成 dragover 回投)。
 */

/** 一帧的滚动位移(px):越界越多越快,夹在 ±max;带外返回 0 */
export function autoscrollDelta(pointerY: number, top: number, height: number, band = 35, max = 14): number {
  const diff = pointerY - top;
  if (diff < band) return Math.max(-max, Math.floor(0.3 * (diff - band)));
  if (diff > height - band) return Math.min(max, Math.floor(0.3 * (diff - (height - band))));
  return 0;
}

export interface DragAutoscroll {
  /** 每次 dragover 记录指针纵向位置:合成事件(synthetic=true)不刷新"指针静止"计时 */
  pointer(clientY: number, synthetic: boolean): void;
  /** 立即停止帧循环(dragend / drop / 拖拽态清理) */
  stop(): void;
}

/** 指针静止后停止滚动的阈值(ms,VS Code 同值) */
const IDLE_STOP_MS = 1000;

/**
 * 建一个自动滚动器:scroller() 取滚动容器,active() 判定拖拽是否仍在进行,
 * recheck() 在滚动后按当前指针位置重算落点。
 */
export function createDragAutoscroll(o: {
  scroller: () => HTMLElement | null;
  active: () => boolean;
  recheck: () => void;
}): DragAutoscroll {
  let raf: number | null = null;
  let y = 0;
  let movedAt = 0;

  const step = (): void => {
    raf = null;
    const sc = o.scroller();
    if (!sc || !o.active()) return;
    if (Date.now() - movedAt > IDLE_STOP_MS) return; // 指针静止:停
    const r = sc.getBoundingClientRect();
    const delta = autoscrollDelta(y, r.top, r.height);
    if (delta !== 0) {
      const before = sc.scrollTop;
      sc.scrollTop = before + delta;
      if (sc.scrollTop !== before) o.recheck();
    }
    raf = window.requestAnimationFrame(step);
  };

  const ensure = (): void => {
    if (raf === null) raf = window.requestAnimationFrame(step);
  };

  return {
    pointer(clientY, synthetic) {
      y = clientY;
      if (!synthetic) movedAt = Date.now();
      ensure();
    },
    stop() {
      if (raf !== null) window.cancelAnimationFrame(raf);
      raf = null;
    },
  };
}

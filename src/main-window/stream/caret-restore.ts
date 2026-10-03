/**
 * 进编辑后流应该滚到哪里、以及**怎样不让用户看到拉扯**(用户 2026-10-03)。
 *
 * 背景:面板比原卡片高、点击又常在卡片中下部 → 面板一挂载其顶部就在视口之上,编辑框与光标跑到屏幕外;
 * 而面板的几何在挂载后还会变(字体替换、框高调整),所以一次性测量会用到过期数据。
 *
 * 之前按 0/120/400/800ms 反复纠正 —— 每一步都改一次 scrollTop,用户看到的就是"拉扯"。
 * 现在:整段对齐在**隐藏窗口**里做完(调用方把流设成 invisible),窗口结束前做最后一次对齐再显示,
 * 之后尺寸观察器只在偏差明显(> 8px)时才纠正,避免细微抖动。
 */
import { caretScrollDelta } from '../editor/caret-screen';
import { measureCaretTop } from '../editor/caret-metrics';

/** 编辑面板里源码框的类名(与 EditPanel 一致) */
export const SOURCE_BOX_CLASS = 'md-source-box';
const SELECTOR = `textarea.${SOURCE_BOX_CLASS}`;
/** 对齐窗口(毫秒):这段时间里流不可见,用户看不到中间过程 */
export const ALIGN_WINDOW_MS = 180;
/** 显示之后的容差:偏差小于它就不动,免得来回抖 */
const TOLERANCE_PX = 8;

export function targetScrollAfterEdit(
  saved: number | null,
  clickY: number | null,
  box: HTMLTextAreaElement | null,
): number | null {
  if (saved === null) return null;
  if (clickY === null || !box) return saved;
  const caretInBox = measureCaretTop(box, box.selectionStart);
  if (caretInBox === null) return saved;
  return saved + caretScrollDelta({
    boxTop: box.getBoundingClientRect().top,
    caretInBox,
    boxScroll: box.scrollTop,
    clickY,
  });
}

/**
 * 对齐窗口:立即 + 窗口内多次重算(都发生在隐藏期间),窗口结束时做最后一次并回调 onSettled。
 * 之后保留尺寸观察器,只在偏差 > TOLERANCE_PX 时纠正。
 */
export function scheduleCaretAlign(
  scroller: { scrollTop: number } | null,
  saved: number | null,
  clickY: number | null,
  schedule: (fn: () => void, delayMs: number) => void,
  onSettled?: () => void,
): void {
  if (saved === null) {
    onSettled?.();
    return;
  }
  const measure = (): number | null =>
    targetScrollAfterEdit(saved, clickY, document.querySelector<HTMLTextAreaElement>(SELECTOR));
  const applyExact = (): void => {
    if (!scroller) return;
    const target = measure();
    if (target !== null) scroller.scrollTop = target;
  };
  applyExact();
  for (const ms of [0, 60, 120]) schedule(applyExact, ms);

  const box = document.querySelector<HTMLTextAreaElement>(SELECTOR);
  const win = box?.ownerDocument.defaultView as (Window & typeof globalThis) | null | undefined;
  let ro: ResizeObserver | null = null;
  if (box && typeof win?.ResizeObserver === 'function') {
    ro = new win.ResizeObserver(() => {
      if (!scroller) return;
      const target = measure();
      if (target !== null && Math.abs(target - scroller.scrollTop) > TOLERANCE_PX) scroller.scrollTop = target;
    });
    ro.observe(box);
  }
  // 窗口结束:最后一次精确对齐,再显示;观察器继续留着但只在明显偏差时纠正。
  // 用 try/finally 保证**一定会显示** —— 量不到几何时抛错会让流永远停在不可见状态。
  schedule(() => {
    try {
      applyExact();
    } finally {
      onSettled?.();
      schedule(() => ro?.disconnect(), 2000);
    }
  }, ALIGN_WINDOW_MS);
}

/**
 * 进编辑后流应该滚到哪里、以及**怎样不让用户看到拉扯**(用户 2026-10-03)。
 *
 * 背景:面板比原卡片高、点击又常在卡片中下部 → 面板一挂载其顶部就在视口之上,编辑框与光标跑到屏幕外;
 * 而面板的几何在挂载后还会变(字体替换、框高调整),所以一次性测量会用到过期数据。
 *
 * 两次失败的做法都记在这里,别再走回去:
 *   ① 多次按定时纠正(0/120/400/800ms)—— 每一步都改 scrollTop,用户看到"拉扯";
 *   ② 把流设成 invisible 做对齐 —— 用户看到"一大段窗口空白"。
 * 现在:对齐由调用方在**首帧之前**触发(useLayoutEffect + rAF),一步修正即到位;之后的纠正只在
 * 偏差 > 8px 时才做。焦点也在这里补 —— 点击的默认行为与重渲染都会把编辑框焦点丢掉,没焦点就不画光标。
 */
import { caretScrollDelta } from '../editor/caret-screen';
import { measureCaretTop } from '../editor/caret-metrics';

/** 编辑面板里源码框的类名(与 EditPanel 一致) */
export const SOURCE_BOX_CLASS = 'md-source-box';
const SELECTOR = `textarea.${SOURCE_BOX_CLASS}`;
/** 之后的容差:偏差小于它就不动,免得来回抖 */
const TOLERANCE_PX = 8;

/**
 * 目标 scrollTop = **当前** scrollTop + 光标屏幕位置与点击位置的差。
 *
 * 用当前值而不是"进编辑前的值":框的视口位置本身就随滚动变化,写成 `saved + delta` 会形成
 * 反馈回路 —— 实测 1 与 465 每 60ms 来回跳。按当前值做一步修正则一步到位(且重复应用收敛)。
 */
export function targetScrollAfterEdit(
  currentScroll: number | null,
  clickY: number | null,
  box: HTMLTextAreaElement | null,
): number | null {
  if (currentScroll === null) return null;
  if (clickY === null || !box) return currentScroll;
  const caretInBox = measureCaretTop(box, box.selectionStart);
  if (caretInBox === null) return currentScroll;
  return currentScroll + caretScrollDelta({
    boxTop: box.getBoundingClientRect().top,
    caretInBox,
    boxScroll: box.scrollTop,
    clickY,
  });
}

/**
 * 对齐 + 补焦点。调用方应在**首帧之前**调用(useLayoutEffect),这样中间过程不会显示给用户。
 * `schedule` 注入便于单测。
 */
export function scheduleCaretAlign(
  scroller: { scrollTop: number } | null,
  saved: number | null,
  clickY: number | null,
  schedule: (fn: () => void, delayMs: number) => void,
): void {
  if (saved === null) return;
  const boxOf = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>(SELECTOR);
  const measure = (): number | null => targetScrollAfterEdit(scroller?.scrollTop ?? null, clickY, boxOf());
  const apply = (): void => {
    if (!scroller) return;
    const target = measure();
    if (target !== null) scroller.scrollTop = target;
  };
  apply();
  for (const ms of [0, 60]) schedule(apply, ms);

  // 面板高度变化(字体替换等)会把光标位置改掉 -> 只在明显偏差时纠正,避免细微抖动
  const box = boxOf();
  const win = box?.ownerDocument.defaultView as (Window & typeof globalThis) | null | undefined;
  if (box && typeof win?.ResizeObserver === 'function') {
    const ro = new win.ResizeObserver(() => {
      if (!scroller) return;
      const target = measure();
      if (target !== null && Math.abs(target - scroller.scrollTop) > TOLERANCE_PX) scroller.scrollTop = target;
    });
    ro.observe(box);
    schedule(() => ro.disconnect(), 3000);
  }

  // 焦点:点击的默认行为与"显示/重渲染"都可能把编辑框的焦点丢掉,补回来(没焦点就不画光标)
  const refocus = (): void => {
    const b = boxOf();
    if (!b || b.ownerDocument.activeElement === b) return;
    b.focus({ preventScroll: true });
    const pos = b.selectionStart;
    b.setSelectionRange(pos, pos);
  };
  for (const ms of [0, 60, 160, 320, 520]) schedule(refocus, ms);
}

/**
 * 进编辑后流应该滚到哪里(用户 2026-10-03:"光标位置和鼠标悬停位置不变为准")。
 *
 * 两件事一起算:
 *   ① 面板比原卡片高、点击又常在卡片中下部 → 面板一挂载其顶部就在视口之上,编辑框与光标跑到屏幕外;
 *   ② 所以目标位置 = 进编辑前的 scrollTop + 让**光标回到点击处**所需的增量。
 * 量不到编辑框 / 量不出光标位置时退回原来的 scrollTop(至少不跳)。
 * 从 NoteStream 抽出:那一份顶着 200 行红线。
 */
import { caretScrollDelta } from '../editor/caret-screen';
import { measureCaretTop } from '../editor/caret-metrics';

/** 编辑面板里源码框的类名(与 EditPanel 一致) */
export const SOURCE_BOX_CLASS = 'md-source-box';


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
 * 多次重算并应用:面板挂载后字体/布局还会变,只量一次会用到过期几何 ——
 * 实测只量一次时光标仍在屏幕外(量到的框顶比稳定后低 300px 以上)。
 * 每次都用**当前**几何重算,越往后越准;拿不到位置时退回原来的 scrollTop。
 */
export function scheduleCaretAlign(
  scroller: { scrollTop: number } | null,
  saved: number | null,
  clickY: number | null,
  schedule: (fn: () => void, delayMs: number) => void,
): void {
  if (saved === null) return;
  const apply = (): void => {
    if (!scroller) return;
    const box = document.querySelector<HTMLTextAreaElement>(`textarea.${SOURCE_BOX_CLASS}`);
    const target = targetScrollAfterEdit(saved, clickY, box);
    if (target !== null) scroller.scrollTop = target;
  };
  apply();
  for (const ms of [0, 120, 400, 800]) schedule(apply, ms);
  // 字体替换 / 面板高度变化都会把光标位置改掉 —— 只靠定时几次会用到过期几何(实测 1.4 秒后又偏了)。
  // 盯住框的尺寸变化:一变就重新对齐;3 秒后自动停(不长期占观察器)。
  const box = document.querySelector<HTMLTextAreaElement>(`textarea.${SOURCE_BOX_CLASS}`);
  const win = box?.ownerDocument.defaultView as (Window & typeof globalThis) | null | undefined;
  if (!box || typeof win?.ResizeObserver !== 'function') return;
  const ro = new win.ResizeObserver(apply);
  ro.observe(box);
  schedule(() => ro.disconnect(), 3000);
}

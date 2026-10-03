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

/** 编辑面板里源码框的选择器(与 EditPanel 的类名一致) */
export const SOURCE_BOX_SELECTOR = 'textarea.md-source-box';

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

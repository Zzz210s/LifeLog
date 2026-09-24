/**
 * 把某条笔记滚进视野(设计 §4 的 `@` 采纳;计划 Task 6 Step 4)。
 *
 * 与浮层的快速打开分开:那里还要"不在结果里就清筛选"的策略与临时高亮,这里只做一件事 ——
 * 找到 `data-note-body={id}` 的行,不在视野内就滚到中间。
 * 采纳是键盘路径:元素不存在(还没加载到/被筛掉)只返回 false,**绝不抛**;
 * jsdom 里既没有真实布局也可能没有 scrollIntoView,一律按可选调用处理。
 */

/** 元素已在视野内就不动;返回"元素是否存在"(副作用只有一次滚动) */
export function visibleOrScroll(el: HTMLElement | null): boolean {
  if (el === null) return false;
  const rect = el.getBoundingClientRect?.();
  const viewport = typeof window === 'undefined' ? 0 : window.innerHeight || 0;
  const inView = rect !== undefined && rect.top >= 0 && (viewport === 0 || rect.bottom <= viewport);
  if (!inView) el.scrollIntoView?.({ block: 'center' });
  return true;
}

/** 按笔记 id 找行并滚进视野;找不到返回 false(调用方据此决定要不要提示) */
export function scrollIntoViewIfNeeded(noteId: number, root: ParentNode = document): boolean {
  return visibleOrScroll(root.querySelector<HTMLElement>(`[data-note-body="${noteId}"]`));
}

/**
 * 把某条笔记滚进视野(设计 §4 的 `@` 采纳;计划 Task 6 Step 4)。
 *
 * 与浮层的快速打开分开:那里还要"不在结果里就清筛选"的策略与临时高亮,这里只做一件事 ——
 * 找到 `data-note-body={id}` 的行,不在视野内就滚到中间。
 * 采纳是键盘路径:元素不存在(还没加载到/被筛掉)只返回 false,**绝不抛**;
 * jsdom 里既没有真实布局也可能没有 scrollIntoView,一律按可选调用处理。
 *
 * 可见性以**滚动容器**(信息流的 `.scroll-gutter`,退化到 overflow-y 可滚的祖先)为准:
 * 用 `window.innerHeight` 会把"刚好滚出容器上沿"的笔记误判成已可见(顶栏/输入框/筛选栏
 * 占掉的那段容器外空间),表现为采纳 `@` 后不滚动(死键)。
 */

/** 最近的滚动容器:先认信息流滚动槽,退化到第一个 overflow-y 可滚的祖先 */
function scrollBox(el: HTMLElement): HTMLElement | null {
  const gutter = el.closest<HTMLElement>('.scroll-gutter');
  if (gutter !== null) return gutter;
  for (let n = el.parentElement; n !== null; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === 'auto' || oy === 'scroll') return n;
  }
  return null;
}

/** 元素已在视野内就不动;返回"元素是否存在"(副作用只有一次滚动) */
export function visibleOrScroll(el: HTMLElement | null): boolean {
  if (el === null) return false;
  const rect = el.getBoundingClientRect?.();
  const box = scrollBox(el);
  const boxRect = box?.getBoundingClientRect?.();
  // 没容器(不在信息流里)时退化回视口:与修前的口径一致
  const top = boxRect === undefined ? 0 : boxRect.top;
  const bottom = boxRect === undefined || boxRect.bottom === 0
    ? (typeof window === 'undefined' ? 0 : window.innerHeight || 0)
    : boxRect.bottom;
  const inView = rect !== undefined && rect.top >= top && (bottom === 0 || rect.bottom <= bottom);
  if (!inView) el.scrollIntoView?.({ block: 'center' });
  return true;
}

/** 按笔记 id 找行并滚进视野;找不到返回 false(调用方据此决定要不要提示) */
export function scrollIntoViewIfNeeded(noteId: number, root: ParentNode = document): boolean {
  return visibleOrScroll(root.querySelector<HTMLElement>(`[data-note-body="${noteId}"]`));
}

/**
 * 快速打开笔记的落地(设计 §3.3):Enter 后关闭浮层,把该笔记滚进流中并高亮;
 * 不在当前筛选结果里时提示,并提供「清除筛选后打开」的路径。
 *
 * 判定拆成纯函数 `locatePlan`(便于单测),DOM 侧只做「找行 + 滚进视野 + 临时高亮」。
 * 行定位走 `data-note-body`(NoteItem 既有属性,不新增约定);`scrollIntoView` 在 jsdom 里
 * 不存在,一律可选调用,不能因为环境缺实现就抛。
 */
import type { Note } from '../../shared/types';

/** 不在结果里且没有任何筛选(库为空 / 未加载到):只提示 */
export const QUICK_OPEN_MISSING_TEXT = '该笔记不在当前筛选结果中';
/** 不在结果里但有筛选:清掉筛选再打开 */
export const QUICK_OPEN_CLEARED_TEXT = '该笔记不在当前筛选结果中,已清除筛选并打开';
/** 高亮停留时长 */
export const QUICK_OPEN_HIGHLIGHT_MS = 1600;

export type LocatePlan = 'found' | 'clear-filters' | 'missing';

/** 目标笔记 -> 落地计划:在结果里直接滚;不在且还有筛选就先清筛选;否则只能提示 */
export function locatePlan(
  notes: readonly Pick<Note, 'id'>[],
  noteId: number,
  filterEmpty: boolean,
): LocatePlan {
  if (notes.some((n) => n.id === noteId)) return 'found';
  return filterEmpty ? 'missing' : 'clear-filters';
}

/** 笔记所在的行(`li`),找不到给 null;取不到 li 时退化为正文容器 */
export function noteRowElement(root: ParentNode, noteId: number): HTMLElement | null {
  const body = root.querySelector<HTMLElement>(`[data-note-body="${noteId}"]`);
  if (body === null) return null;
  return (body.closest('li') ?? body) as HTMLElement;
}

/** 临时高亮(加类 -> 到点移除);用既有 tailwind 类,不新增样式约定 */
export function flashNote(row: HTMLElement, ms: number = QUICK_OPEN_HIGHLIGHT_MS): void {
  row.classList.add('bg-accent-soft', 'transition-colors');
  window.setTimeout(() => row.classList.remove('bg-accent-soft', 'transition-colors'), ms);
}

/** 滚到流中该笔记并高亮;找不到返回 false(调用方据此给提示) */
export function scrollToNote(root: ParentNode, noteId: number): boolean {
  const row = noteRowElement(root, noteId);
  if (row === null) return false;
  row.scrollIntoView?.({ block: 'center' });
  flashNote(row);
  return true;
}

import type { Note } from '../shared/types';

/** 追加分页去重(筛选翻转期间的新旧页可能交叠) */
export function mergeNotes(prev: Note[], page: Note[]): Note[] {
  const seen = new Set(prev.map((n) => n.id));
  return [...prev, ...page.filter((n) => !seen.has(n.id))];
}

/** 就地替换同 id 笔记(保持分页与滚动位置);id 不在列表中时原样返回 */
export function replaceNote(prev: Note[], next: Note): Note[] {
  return prev.map((n) => (n.id === next.id ? next : n));
}

/** 激活标签筛选是否仍全部命中该条:就地更新(勾选/编辑掉标签)后据此决定是否从列表移除 */
export function matchesTagFilter(note: Note, tags: string[]): boolean {
  return tags.every((t) => note.tags.includes(t));
}

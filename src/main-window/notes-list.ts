import type { Note } from '../shared/types';

/** 每次拉取的页大小(查询分页) */
export const PAGE = 50;

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

/** 就地变更判定所需的最小筛选集合 */
export interface FeedFilters {
  keyword: string;
  tags: string[];
}

/**
 * 就地变更(编辑保存/勾选待办)后是否需要重查首页。
 * 决策(G5):keyword 非空时必须重查 —— 后端 keyword 同时匹配正文与标签两列,且 FTS 短语/前缀
 * 语义与本地子串判定不一致,本地无法判定命中,正确性优先于滚动位置;
 * keyword 为空时只重判标签,标签命中可本地判定(matchesTagFilter),保持就地更新不丢分页与滚动(S3)。
 */
export function needsRefetchAfterChange(f: FeedFilters): boolean {
  return f.keyword.trim() !== '';
}

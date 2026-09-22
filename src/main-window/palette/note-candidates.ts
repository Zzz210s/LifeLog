/**
 * 快速打开的笔记候选池(设计 §3.3):最近 N=200 条,分页取回后缓存。
 *
 * - 取回策略:从 offset 0 起按 `PAGE` 分页,直到取满 4 页或某页不满(库小的时候不多打库);
 * - 缓存是**整个 promise**(并发调用共享同一次取回);`refresh()` 只作废缓存,下次调用重取
 *   (每次打开浮层作废一次,保证刚保存的笔记也能被搜到);
 * - 失败原样抛:由浮层落到错误条,不静默成"空候选"。
 */
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';

/** 与主窗流一致的分页大小(query_notes 的页大小由后端固定) */
export const NOTES_PAGE = 50;
/** 候选页数:4 x 50 = 200(设计 §3.3 的 QUICK_OPEN_LIMIT) */
export const NOTES_PAGES = 4;

/** 候选查询条件:全部笔记、最新在前(不继承主窗筛选 —— 快速打开要能跨筛选找到) */
export function recentConditions(): FilterConditions {
  return { ...EMPTY_FILTER, tags: [], excludeTags: [] };
}

/** FTS 追加查询条件:关键词走后端(与流内筛选同一实现) */
export function searchConditions(keyword: string): FilterConditions {
  return { ...recentConditions(), keyword };
}

export interface NoteCandidates {
  /** 取候选(带缓存;并发共享) */
  current(): Promise<readonly Note[]>;
  /** 作废缓存(下次调用重取) */
  refresh(): void;
}

export function createNoteCandidates(
  fetchPage: (offset: number) => Promise<readonly Note[]>,
  pages: number = NOTES_PAGES,
): NoteCandidates {
  let cache: Promise<readonly Note[]> | null = null;

  const load = async (): Promise<readonly Note[]> => {
    const out: Note[] = [];
    for (let i = 0; i < pages; i++) {
      const page = await fetchPage(i * NOTES_PAGE);
      out.push(...page);
      if (page.length < NOTES_PAGE) break; // 已到末页
    }
    return out.slice(0, pages * NOTES_PAGE);
  };

  return {
    current: () => (cache ??= load()),
    refresh: () => {
      cache = null;
    },
  };
}

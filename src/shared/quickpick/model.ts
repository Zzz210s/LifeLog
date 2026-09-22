/**
 * QuickPick 列表模型(D6,设计 §4.2):过滤 → 排序 → 截断 → 计数。
 *
 * 纯函数、无 IO、无 React:候选、MRU、固定项全部由调用方传入(落盘与查询在 T5/T6/T8)。
 * 排序规则:
 * - 空查询:固定项(按传入顺序)→ 最近用过(次数降序)→ 全量(按传入顺序)。
 * - 有查询:按分数降序(同分保持传入顺序);固定项**不插队**,未命中即不出现。
 * 命中位置一律来自打分器(fuzzy-score),模型只做投影,不另写 matcher(设计 §4.2 纪律 1)。
 */
import { EMPTY_QUERY_SCORE, mergePositions, scoreFuzzy, type MatchRange } from '../fuzzy-score';

/** 浮层渲染上限(设计 §3.3 QUICK_OPEN_LIMIT) */
export const QUICK_OPEN_LIMIT = 200;
/** 输入栏补全显示上限(设计 §3.5 COMPLETE_LIMIT) */
export const COMPLETE_LIMIT = 8;

export interface QuickPickItem {
  readonly id: string;
  /** 参与打分的主文案(命令标题 / 笔记首行 / 标签路径) */
  readonly label: string;
  /**
   * provider 预计算的分数(分层排序用:笔记「标题 > 正文 > 标签」按
   * PATH_BOOST / LABEL_PREFIX_BOOST / LABEL_MATCH_BOOST 三档叠加)。
   * 给定时模型不再对 label 打分,直接采信(<= 0 视为不命中)。
   */
  readonly score?: number;
  /** 与 score 配对的命中位置;缺省为空 */
  readonly positions?: readonly number[];
}

/** 最近用过的一项(由 createMru().entries() 提供;顺序不要求预先排序) */
export interface MruEntry {
  readonly id: string;
  readonly count: number;
}

export interface ListRow {
  readonly item: QuickPickItem;
  readonly score: number;
  readonly positions: readonly number[];
  /** 相邻命中合并后的段,供 `<mark>` 渲染 */
  readonly ranges: readonly MatchRange[];
  readonly pinned: boolean;
  readonly mruCount: number;
}

export interface BuildListOptions {
  readonly items: readonly QuickPickItem[];
  readonly query: string;
  /** 缺省 QUICK_OPEN_LIMIT */
  readonly limit?: number;
  readonly mru?: readonly MruEntry[];
  /** 固定项 id,数组顺序即固定档顺序 */
  readonly pinned?: readonly string[];
}

export interface ListResult {
  readonly rows: readonly ListRow[];
  /** 截断**之前**的命中数(UI 计数「N 项」) */
  readonly total: number;
  readonly truncated: boolean;
}

interface Scored {
  item: QuickPickItem;
  score: number;
  positions: readonly number[];
}

/** 空查询:固定 → 最近 → 全量(排序稳定,同档保持传入顺序) */
function orderDefault(
  items: readonly QuickPickItem[],
  pinnedRank: Map<string, number>,
  mruRank: Map<string, number>,
): Scored[] {
  const tier = (id: string): number => (pinnedRank.has(id) ? 0 : mruRank.has(id) ? 1 : 2);
  const rank = (id: string, t: number): number =>
    t === 0 ? pinnedRank.get(id)! : t === 1 ? mruRank.get(id)! : 0;

  return items
    .map((item) => ({ item, tier: tier(item.id) }))
    .sort((a, b) => a.tier - b.tier || rank(a.item.id, a.tier) - rank(b.item.id, b.tier))
    .map(({ item }) => ({ item, score: EMPTY_QUERY_SCORE, positions: [] }));
}

/** 有查询:provider 预计算分优先,否则按主文案打分;未命中直接过滤 */
function orderScored(items: readonly QuickPickItem[], query: string): Scored[] {
  const scored: Scored[] = [];
  for (const item of items) {
    if (item.score !== undefined) {
      if (item.score > 0) scored.push({ item, score: item.score, positions: item.positions ?? [] });
      continue;
    }
    const hit = scoreFuzzy(query, item.label);
    if (hit.score > 0) scored.push({ item, score: hit.score, positions: hit.positions });
  }
  return scored.sort((a, b) => b.score - a.score); // Array#sort 稳定:同分保持传入顺序
}

export function buildList(options: BuildListOptions): ListResult {
  const { items, query, limit = QUICK_OPEN_LIMIT, mru = [], pinned = [] } = options;

  const pinnedRank = new Map(pinned.map((id, index) => [id, index]));
  // 模型自己按次数排序,调用方不必预排(同次数按传入顺序 = 最近的在前)
  const mruRank = new Map<string, number>();
  [...mru]
    .sort((a, b) => b.count - a.count)
    .forEach((entry, index) => {
      if (!mruRank.has(entry.id)) mruRank.set(entry.id, index);
    });

  const matched = query === '' ? orderDefault(items, pinnedRank, mruRank) : orderScored(items, query);
  const capped = Math.max(0, limit);
  const rows = matched.slice(0, capped).map((row): ListRow => ({
    item: row.item,
    score: row.score,
    positions: row.positions,
    ranges: mergePositions([...row.positions]),
    pinned: pinnedRank.has(row.item.id),
    mruCount: mru.find((entry) => entry.id === row.item.id)?.count ?? 0,
  }));

  return { rows, total: matched.length, truncated: matched.length > rows.length };
}

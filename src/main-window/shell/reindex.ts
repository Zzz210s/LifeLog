/**
 * 重建搜索索引(Rust 的 `rebuild_search_index`)的一次执行 + 耗时读数。
 * 为什么单拎出来:同一条实现有两个入口 —— 命令面板(`search.reindex`,状态条里回 N 条)
 * 与设置页「维护」小节(要多给一个耗时回执)。两处各写一份会漂,所以执行只在这里,
 * 认不认账(确认框 / 回执怎么显示)各入口自己决定。
 */
import { api } from '../../shared/api';

export interface ReindexResult {
  /** 重建后 FTS 里的条目数(Rust 返回) */
  rows: number;
  /** 这一次重建花掉的毫秒数(不含确认框) */
  ms: number;
}

export async function reindexNow(): Promise<ReindexResult> {
  const t0 = performance.now();
  const rows = await api.rebuildSearchIndex();
  return { rows, ms: Math.round(performance.now() - t0) };
}

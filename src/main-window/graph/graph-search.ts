/**
 * 图内搜索的候选排序(纯函数,G2 Task 7)。
 *
 * 打分的对象是 `tagLabelPlain(path)` —— 标签名里的行内 md 语法(加粗/链接/删除线)是备注
 * 而不是名字本身,拿原始路径去匹配会让「郴州市」这类带链接备注的标签搜不到(见 shared/tag-label)。
 * 引擎与命令面板/标签补全同源(`shared/fuzzy-score`),子序列也能命中,排序口径一致。
 */
import { scoreFuzzy } from '../../shared/fuzzy-score';
import { tagLabelPlain } from '../../shared/tag-label';
import type { GraphNode } from '../../shared/types';

/** 候选上限:搜索框下方的列表最多 8 条,再多就得滚动(口径由计划定死) */
export const SEARCH_LIMIT = 8;

/**
 * 按查询串给图节点打分并取前 `limit` 条(默认 8)。
 * 空查询(或纯空白)返回空数组:没输入就不该先摆一屏候选。
 */
export function searchNodes(
  nodes: readonly GraphNode[],
  query: string,
  limit: number = SEARCH_LIMIT,
): GraphNode[] {
  const q = query.trim();
  if (q === '' || limit <= 0) return [];
  const scored: { node: GraphNode; score: number }[] = [];
  for (const node of nodes) {
    const hit = scoreFuzzy(q, tagLabelPlain(node.path));
    if (hit.score > 0) scored.push({ node, score: hit.score });
  }
  // 同分保持输入序(JS sort 稳定):图节点本身按路径序给,同分时顺序可预期
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.node);
}

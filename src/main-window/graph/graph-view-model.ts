import type { GraphData, GraphEdge, GraphNode } from '../../shared/types';

/** 默认折叠的根标签(设计 D8:时间轴默认折叠)。视图与真机读数探针共读这一份口径。 */
export const DEFAULT_COLLAPSED = ['时间'] as const;

/**
 * 可见性:折叠某个根标签 = 只保留该根节点本身。
 * 它的后代节点全部隐藏,且"至少一端不可见"的边一并丢弃(不留悬空边)。
 */
export function visibleGraph(
  data: GraphData,
  opts: { collapsedRoots: readonly string[] },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const hidden = new Set<number>();
  for (const root of opts.collapsedRoots) {
    // 防御性:调用方若传入不存在的路径则静默跳过(而非抛错)。
    const node = data.nodes.find((n) => n.path === root);
    if (!node) continue;
    for (const n of data.nodes) {
      // `${root}/` 已排除根自身,`n.id !== node.id` 只是防御性兜底(同前缀同 id 的重复节点)。
      if (n.id !== node.id && n.path.startsWith(`${root}/`)) hidden.add(n.id);
    }
  }
  const nodes = data.nodes.filter((n) => !hidden.has(n.id));
  const kept = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => kept.has(e.a) && kept.has(e.b));
  return { nodes, edges };
}

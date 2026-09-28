import type { GraphData, GraphEdge, GraphNode } from '../../shared/types';

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
    const node = data.nodes.find((n) => n.path === root);
    if (!node) continue;
    for (const n of data.nodes) {
      if (n.id !== node.id && n.path.startsWith(`${root}/`)) hidden.add(n.id);
    }
  }
  const nodes = data.nodes.filter((n) => !hidden.has(n.id));
  const kept = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => kept.has(e.a) && kept.has(e.b));
  return { nodes, edges };
}

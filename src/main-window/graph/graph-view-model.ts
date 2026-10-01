import type { GraphData, GraphEdge, GraphNode } from '../../shared/types';

// 注意(2026-10-01):视图已改走 graph-filters 的 applyFilters(过滤与折叠合一),
// 这里的 visibleGraph 现在**只被验收脚本**(scripts/graph-accept-lib.mjs)用来对齐口径;
// 新代码不要再引它,否则会出现两套"隐藏"语义。

/**
 * 默认折叠哪一根:从时间标签模板(设置 `time_tag_template` 的原文)派生。
 * 取首段作根名,要求模板至少两层 —— 单层模板(如 `时间`)不是树,没有可折叠的子级。
 * 首段是占位符(`{y}/{m}/{d}`)时也没有可折叠的根名。用户改根名后折叠跟着走
 * (旧实现写死 `'时间'`,改名即静默失效;探针与视图共读这一份口径)。
 */
export function collapseRootsOf(template: string | null | undefined): string[] {
  const segs = (template ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const [root] = segs;
  if (root === undefined || segs.length < 2 || root.includes('{')) return [];
  return [root];
}

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

// vault → graph-core 的 GraphData。语义照原生：节点=实体，边=父子(tree) + 共现(co)。
import type { GraphData, GraphEdge, GraphNode } from './core/types/graph';

export type EntityRow = { path: string; parentPath: string | null; weight: number };

export type NoteRef = { targets: string[] };

export function buildGraph(entities: EntityRow[], notes: NoteRef[], minCo = 2): GraphData {
  const byPath = new Map<string, number>();
  entities.forEach((e, i) => byPath.set(e.path, i + 1));

  const nodes: GraphNode[] = entities.map((e, i) => {
    const depth = e.path.split('/').length;
    const parentId = e.parentPath ? byPath.get(e.parentPath) ?? null : null;
    return {
      id: i + 1,
      path: e.path,
      depth,
      parent: parentId,
      notes: e.weight,
      selfCount: e.weight,
      sortOrder: i,
    };
  });

  const edges: GraphEdge[] = [];
  for (const n of nodes) {
    if (n.parent !== null) edges.push({ a: n.parent, b: n.id, kind: 'tree', weight: 1 });
  }

  // 共现：同一篇笔记里出现过的两个实体，按次数累计（与原生 co 边同口径）
  const co = new Map<string, number>();
  for (const note of notes) {
    const ids = [...new Set(note.targets.map((t) => byPath.get(t)).filter((v): v is number => v !== undefined))].sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}-${ids[j]}`;
        co.set(key, (co.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, weight] of co) {
    if (weight < minCo) continue;
    const [a, b] = key.split('-').map(Number);
    edges.push({ a, b, kind: 'co', weight });
  }
  return { nodes, edges };
}

import type { GraphEdge } from '../../shared/types';

export interface Emphasis {
  /** 当前被强调的节点(选中优先于悬停);null 表示没有强调,谁都不弱化 */
  active: number | null;
  /** active 的 1 跳邻居 */
  neighbors: Set<number>;
}

/** 1 跳邻居:父子边与共现边同等对待(图里都是"关系") */
export function neighborsOf(edges: readonly GraphEdge[], id: number): Set<number> {
  const out = new Set<number>();
  for (const e of edges) {
    if (e.a === id) out.add(e.b);
    else if (e.b === id) out.add(e.a);
  }
  return out;
}

/** 强调集合:选中的节点优先于悬停的节点(点开后不该被鼠标划走打断) */
export function emphasisOf(input: {
  selected: number | null;
  hovered: number | null;
  edges: readonly GraphEdge[];
}): Emphasis {
  const active = input.selected ?? input.hovered;
  return { active, neighbors: active === null ? new Set() : neighborsOf(input.edges, active) };
}

/** 该节点是否要弱化(有强调时,自己与邻居之外都弱化) */
export function isDimmed(id: number, em: Emphasis): boolean {
  if (em.active === null) return false;
  return id !== em.active && !em.neighbors.has(id);
}

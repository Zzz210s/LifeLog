import type { GraphNode } from '../../shared/types';

export interface Point { x: number; y: number }

/** 子树节点数(含自身):角度按它分配,大分支不会被挤成一条线 */
function subtreeSizes(nodes: readonly GraphNode[]): Map<number, number> {
  const kids = new Map<number | null, number[]>();
  for (const n of nodes) {
    const list = kids.get(n.parent) ?? [];
    list.push(n.id);
    kids.set(n.parent, list);
  }
  const size = new Map<number, number>();
  const walk = (id: number): number => {
    let total = 1;
    for (const k of kids.get(id) ?? []) total += walk(k);
    size.set(id, total);
    return total;
  };
  for (const n of nodes) if (n.parent === null || !nodes.some((x) => x.id === n.parent)) walk(n.id);
  return size;
}

/**
 * 径向确定性布局:根在中心、半径 = (depth - 1) * layerGap、同层角度按子树大小分配。
 * 复杂度 O(n);同输入必然同输出(可复现,便于单测与"位置记忆"叠加)。
 */
export function radialLayout(nodes: readonly GraphNode[], opts: { layerGap: number }): Map<number, Point> {
  const kids = new Map<number, number[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const parent = n.parent !== null && ids.has(n.parent) ? n.parent : null;
    const list = kids.get(parent ?? -1) ?? [];
    list.push(n.id);
    kids.set(parent ?? -1, list);
  }
  const size = subtreeSizes(nodes);
  const out = new Map<number, Point>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const place = (id: number, from: number, to: number): void => {
    const mid = (from + to) / 2;
    const depth = byId.get(id)?.depth ?? 1;
    const r = (depth - 1) * opts.layerGap;
    out.set(id, { x: Math.cos(mid) * r, y: Math.sin(mid) * r });
    const children = kids.get(id) ?? [];
    const total = children.reduce((s, c) => s + (size.get(c) ?? 1), 0) || 1;
    let at = from;
    for (const c of children) {
      const span = ((to - from) * (size.get(c) ?? 1)) / total;
      place(c, at, at + span);
      at += span;
    }
  };
  const roots = kids.get(-1) ?? [];
  const totalRoot = roots.reduce((s, c) => s + (size.get(c) ?? 1), 0) || 1;
  let at = 0;
  for (const r of roots) {
    const span = (Math.PI * 2 * (size.get(r) ?? 1)) / totalRoot;
    place(r, at, at + span);
    at += span;
  }
  return out;
}

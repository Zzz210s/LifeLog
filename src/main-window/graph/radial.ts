import type { GraphNode } from '../../shared/types';

export interface Point { x: number; y: number }

/** 根层半径系数:多个根不能都落在圆心(真实库 23 个根会叠成一点),放内圈、仍在中心附近 */
const ROOT_RADIUS_FACTOR = 0.35;

/** 子树节点数(含自身):角度按它分配,大分支不会被挤成一条线 */
function subtreeSizes(nodes: readonly GraphNode[]): Map<number, number> {
  const ids = new Set(nodes.map((n) => n.id));
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
  // 只从根(无父,或父不在可见集合里)起 DFS:成环/自指的点没有根,大小算不出来
  for (const n of nodes) if (n.parent === null || !ids.has(n.parent)) walk(n.id);
  return size;
}

/** cos(π) · 0 === -0,而 vitest 的 toEqual 区分 ±0;落位时统一归一 */
const noNegZero = (v: number): number => (v === 0 ? 0 : v);

/**
 * 径向确定性布局:根在内圈(0.35 × layerGap,避免多根叠在圆心)、
 * 非根半径 = (depth - 1) × layerGap、同层角度按子树大小切分。
 * 复杂度 O(n)(建 id 集合、建树、DFS 各一遍);同输入必然同输出(便于单测与"位置记忆"叠加)。
 * 前置条件:输入须为森林。成环/自指的点没有根,会被漏掉并 console.warn —— 只报警不抛错,脏数据不该整图崩。
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
    const r = depth === 1 ? opts.layerGap * ROOT_RADIUS_FACTOR : (depth - 1) * opts.layerGap;
    out.set(id, { x: noNegZero(Math.cos(mid) * r), y: noNegZero(Math.sin(mid) * r) });
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
  if (out.size !== nodes.length) {
    console.warn(`关系图布局:输入 ${nodes.length} 个节点,落位 ${out.size} 个(存在成环或自指节点?)`);
  }
  return out;
}

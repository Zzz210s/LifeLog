import type { GraphEdge } from '../../shared/types';
import type { RelationEdge } from './graph-relations';

export interface Emphasis {
  /**
   * 当前焦点(**悬停优先于选中**);null 表示没有焦点,谁都不弱化。
   * `active` = 当前焦点,`selected` = 选中,**二者可以不同**(选中 A 后悬停 B,则 `active = B`、`selected = A`);
   * 邻居及其连线的强调跟 `active` 走,选中环与信息条跟 `selected` 走。
   */
  active: number | null;
  /** active 的 1 跳邻居 */
  neighbors: Set<number>;
  /** 选中的节点,与焦点解耦:选中环与信息条按它画,不随鼠标移走 */
  selected: number | null;
}

/**
 * 没有交互态时的强调值(active = selected = null):等价于 `emphasisOf({ selected: null, hovered: null, edges })`。
 * 只读单例,被 GraphView 与多处测试共用 —— `Object.freeze` 只挡住改字段,`neighbors` 那个空 Set
 * 仍能被 `add`(Set 的内部槽冻结不了),所以约定:**谁都不许改它**。
 */
export const NO_EMPHASIS: Emphasis = Object.freeze({
  active: null,
  neighbors: new Set<number>(),
  selected: null,
});

/** 1 跳邻居:父子边、共现边与**标签关系边**同等对待(图里都是"关系") */
export function neighborsOf(
  edges: readonly GraphEdge[],
  id: number,
  relations: readonly RelationEdge[] = [],
): Set<number> {
  const out = new Set<number>();
  for (const e of edges) {
    if (e.a === id) out.add(e.b);
    else if (e.b === id) out.add(e.a);
  }
  for (const r of relations) {
    if (r.a === id) out.add(r.b);
    else if (r.b === id) out.add(r.a);
  }
  return out;
}

/**
 * 强调集合:**悬停优先于选中** —— 鼠标所在之处必须是焦点,否则「选中 A 后悬停 B」会
 * 把光标正指着的 B 画成 20% 透明、B 的邻居全暗、气泡还讲着 B。
 * 选中不参与焦点选择,只经由 `selected` 影响选中环与信息条。
 */
export function emphasisOf(input: {
  selected: number | null;
  hovered: number | null;
  edges: readonly GraphEdge[];
  /** 标签关系边:参与邻居集合,与父子/共现边同一套高亮 */
  relations?: readonly RelationEdge[];
}): Emphasis {
  const active = input.hovered ?? input.selected;
  const neighbors =
    active === null ? new Set<number>() : neighborsOf(input.edges, active, input.relations ?? []);
  return { active, neighbors, selected: input.selected };
}

/**
 * 该节点是否要弱化(有焦点时,焦点、焦点邻居、以及选中点之外都弱化)。
 * 选中点即使不是焦点也不弱化 —— 它带着选中环,暗掉会显得选中态丢了。
 */
export function isDimmed(id: number, em: Emphasis): boolean {
  if (em.active === null) return false;
  return id !== em.active && id !== em.selected && !em.neighbors.has(id);
}

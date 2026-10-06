/**
 * 标签关系边的数据口径(Task 5,设计 §8):`tag_links(A,'tag',B)` 读作「A 具有 B 所表示的属性」。
 *
 * 关系数据不走 `graph_data`(那条命令只交标签骨架与笔记链接),改用前端已有的
 * `list_tag_facts` 批量事实就地摊平 —— 24 条边不值得多一条 IPC,也不给 Rust 侧添接口。
 * 备注取**被指向标签 B 自己的名字备注**(`RelationRef.remark`),仅显示用(R6 不参与筛选/计数)。
 */
import type { TagFact } from '../../shared/tag-facts-types';
import type { GraphNode } from '../../shared/types';

/** 一条标签关系边(方向固定 A -> B) */
export interface RelationEdge {
  /** 起点标签 id(具有属性的一方) */
  a: number;
  /** 终点标签 id(被指向的属性) */
  b: number;
  /** 箭头上的文字备注(取 B 的名字备注;缺失为空串,缺失时图上不画字) */
  remark: string;
}

/** 批量事实摊平成关系边:一条出边一行,顺序沿用事实顺序 */
export function relationEdges(facts: readonly TagFact[]): RelationEdge[] {
  const out: RelationEdge[] = [];
  for (const f of facts) {
    for (const r of f.relations) out.push({ a: f.tagId, b: r.toTagId, remark: r.remark });
  }
  return out;
}

/**
 * 某标签(**含子孙**)的关系出/入度,与信息条既有的出链/入链同一口径:
 * - 出 N = 起点落在该子树里的边数
 * - 入 M = 终点落在该子树里的边数
 * 靠子级撑起来的骨架节点(如 `作者` 根本身没有边)只算子级会永远显示 0,含子孙才与「含子级」计数一致。
 */
export function relationDegrees(
  relations: readonly RelationEdge[],
  nodes: readonly GraphNode[],
  id: number,
): { outbound: number; backlinks: number } {
  const children = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.parent === null) continue;
    const list = children.get(n.parent);
    if (list === undefined) children.set(n.parent, [n.id]);
    else list.push(n.id);
  }
  const sub = new Set<number>([id]);
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const c of children.get(cur) ?? []) {
      if (sub.has(c)) continue; // 防御:库里成环时不死循环
      sub.add(c);
      stack.push(c);
    }
  }
  let outbound = 0;
  let backlinks = 0;
  for (const r of relations) {
    if (sub.has(r.a)) outbound += 1;
    if (sub.has(r.b)) backlinks += 1;
  }
  return { outbound, backlinks };
}

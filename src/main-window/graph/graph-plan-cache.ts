/**
 * 绘制计划的**跨帧不变件**缓存(2026-10-06 性能轮)。
 *
 * 相机一动整个 plan 就要重建 —— 视口裁剪、屏幕坐标、每一段几何都得重算,这是计划本身的口径。
 * 但有一批东西**只跟 `nodes`/`edges` 有关**:节点 id -> 根轴名、节点 id -> 笔记数、节点 id -> 度数。
 * 它们此前在每一帧里从零重建(768 个节点的 Map、每条边两次 Map 写),纯属白烧 CPU 与 GC ——
 * 缩放/拖拽 60 帧/秒时就是每秒几十万次无谓分配。
 *
 * 缓存键用**数组引用**(WeakMap):视图的数据一换引用(IPC 回来、过滤器换档)就自动失效,
 * 不留悬挂、不用手工清理,也不需要版本号。
 *
 * 为什么不缓存颜色:轴色是**主题令牌**的读数,口径是「主题变了必须重建 plan」——
 * 那件事由 `use-graph-plan` 的 memo 依赖(`themeKey`)管,混进这里会把两套失效口径搅在一起。
 */
import type { GraphEdge, GraphNode } from '../../shared/types';
import { nodeColors, rootAxisOf } from './graph-palette';

export interface NodeFacts {
  /** 节点 id -> 根轴名(判「是否与焦点同轴」) */
  axisOf: Map<number, string>;
  /** 节点 id -> 该节点名下的笔记数(关系层箭头回收的半径兜底口径) */
  notesById: Map<number, number>;
}

const factsCache = new WeakMap<readonly GraphNode[], NodeFacts>();
const degreeCache = new WeakMap<readonly GraphEdge[], Map<number, number>>();
const colorCache = new WeakMap<readonly GraphNode[], { key: string; value: Map<number, string> }>();

/** 节点的派生件(根轴名 + 笔记数):同一遍循环建两张表,同一个 `nodes` 引用只建一次 */
export function nodeFacts(nodes: readonly GraphNode[]): NodeFacts {
  const hit = factsCache.get(nodes);
  if (hit !== undefined) return hit;
  const axisOf = new Map<number, string>();
  const notesById = new Map<number, number>();
  for (const n of nodes) {
    axisOf.set(n.id, rootAxisOf(n.path));
    notesById.set(n.id, n.notes);
  }
  const value = { axisOf, notesById };
  factsCache.set(nodes, value);
  return value;
}

/** 节点 id -> 度数(父子边 + 共现边之和;枢纽环判据);同一个 `edges` 引用只建一次 */
export function edgeDegrees(edges: readonly GraphEdge[]): Map<number, number> {
  const hit = degreeCache.get(edges);
  if (hit !== undefined) return hit;
  const degree = new Map<number, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  degreeCache.set(edges, degree);
  return degree;
}

/**
 * 轴色表:同一个 `nodes` 引用 + 同一个颜色口径(主题键)只算一次。
 * `key` 就是主题键 —— 亮暗切换后令牌值是新的,memo 会带着新 `themeKey` 重来一遍,这里也就跟着重建;
 * 相机只在动(缩放/拖拽)时 `themeKey` 不变,令牌读数不再每帧发生。
 */
export function cachedNodeColors(
  nodes: readonly GraphNode[],
  read: (slot: number) => string,
  colorKey: string,
): Map<number, string> {
  const hit = colorCache.get(nodes);
  if (hit !== undefined && hit.key === colorKey) return hit.value;
  const value = nodeColors(nodes, read);
  colorCache.set(nodes, { key: colorKey, value });
  return value;
}

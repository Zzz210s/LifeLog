/**
 * 视图外壳要的三件派生读数(G3 Task 6 自 `GraphView` 抽出,守它的 200 行红线):
 * 选中/悬停命中的**节点对象**(信息条与 `Esc` 要 path、气泡要整个节点)、状态条文案、标签 id -> path。
 * 都是"由已有状态算出来"的消费口径,自己不持状态 —— 抽出来不改任何行为。
 * 纯函数:不碰 DOM、不读设置,与 `graph-filters` / `graph-draw-plan` 同一处理。
 */
import type { GraphEdge, GraphNode } from '../../shared/types';
import type { ExpandedNotesApi } from './use-expanded-notes';

export interface GraphHints {
  /** 选中的标签(信息条与 `Esc` 用它的 path);没选中为 null */
  selectedNode: GraphNode | null;
  /** 悬停的标签(气泡用它);没悬停为 null */
  hoveredNode: GraphNode | null;
  /** 左上角状态条的文案 */
  count: string;
}

export function graphHints(input: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  selected: number | null;
  hovered: number | null;
  /** 图数据取数失败 */
  failed: boolean;
  /** 展开条目的读数:它的过程状态(展开中 / 失败)优先占文案位 */
  expandedNotes: ExpandedNotesApi;
}): GraphHints {
  const { nodes, edges, selected, hovered, failed, expandedNotes: exp } = input;
  const selectedNode = selected === null ? null : (nodes.find((n) => n.id === selected) ?? null);
  const hoveredNode = hovered === null ? null : (nodes.find((n) => n.id === hovered) ?? null);
  // 展开条目的状态优先占状态条文案位(用户当下最关心的那件事);没在展开就跟原来一样报计数
  const noteHint = exp.failed ? '条目加载失败' : exp.loading ? '正在展开条目…' : null;
  const count = noteHint ?? (failed ? '关系图加载失败' : `${nodes.length} 个节点 / ${edges.length} 条边`);
  return { selectedNode, hoveredNode, count };
}

/** 标签 id -> path(缺项返回 null:图数据里已经没有这个标签) */
export function nodePath(nodes: readonly GraphNode[], id: number): string | null {
  return nodes.find((n) => n.id === id)?.path ?? null;
}

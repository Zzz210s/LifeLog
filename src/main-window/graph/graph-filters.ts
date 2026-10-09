/**
 * 关系图的四项过滤器(设计 §2.3)。
 *
 * 口径(2026-10-01 定死):**轴勾选框 = "展开这条轴"**。
 *   - 勾上:该轴整棵子树都参与后面的深度/计数过滤;
 *   - 取消:该轴**只留根节点**(就是设计 D8 的"时间轴默认折叠,图里只留 时间 一个节点")。
 * 这样"折叠"与"过滤"是同一个概念,不会出现"折叠了但轴还勾着"的矛盾;面板上也没有"整条轴消失"这个档位。
 *
 * 纯函数:不碰 DOM、不读设置,便于单测与真机读数共用。
 */
import type { GraphData, GraphEdge, GraphLink, GraphNode } from '../../shared/types';

export interface GraphFilters {
  /** 勾选(=展开)的根标签(轴) */
  axes: string[];
  /** 深度上限 1-6 */
  maxDepth: number;
  /** 只显示有条目的实体 */
  onlyWithNotes: boolean;
  /** 最少条目数(含子级) */
  minNotes: number;
}

export const MAX_DEPTH_LIMIT = 6;
export const MIN_NOTES_CHOICES = [0, 1, 5, 20] as const;

/** 所有根标签(轴),按 path 排序 */
export function axisOptions(data: GraphData): string[] {
  return data.nodes
    .filter((n) => n.parent === null)
    .map((n) => n.path)
    .sort();
}

/** 默认:展开除折叠根之外的所有轴(时间轴默认折叠 —— 它一棵子树就占全库一半节点)
 *
 * T4.2 重标定读数(2026-10-09 真库 v29;闭包 742 节点、时间子树 385):
 * - `maxDepth` 6:**闭包最大 depth = 5**(1:24 / 2:216 / 3:91 / 4:95 / 5:316),默认值即"全可见",
 *   留一档余量,不截断;
 * - `onlyWithNotes` 与 `minNotes` 的 1 档:**结构性空转** —— 闭包 = 被引用 ∪ 其祖先,每个节点的
 *   含子级 `notes` 必 >= 1(实测 0 个节点为 0),这两档在本模型下筛不掉任何东西;
 *   默认值(false / 0 = 全显示)因此保持不动(要真能筛,得改成"本级有笔记"的口径,那是语义变更,
 *   不在阈值重标定范围内);
 * - `minNotes` 其余档位仍有区分度:>= 5 -> 180 个节点,>= 20 -> 69 个。
 */
export function defaultFilters(roots: readonly string[], collapsed: readonly string[]): GraphFilters {
  const off = new Set(collapsed);
  return {
    axes: roots.filter((r) => !off.has(r)),
    maxDepth: MAX_DEPTH_LIMIT,
    onlyWithNotes: false,
    minNotes: 0,
  };
}

/** 该节点属于哪条轴(根标签路径):沿 parent 上溯到根;成环/自指时返回 null(落不了位的点不进图) */
export function axisOf(data: GraphData, id: number): string | null {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  let cur = byId.get(id);
  const seen = new Set<number>();
  while (cur !== undefined && cur.parent !== null) {
    if (seen.has(cur.id)) return null; // 成环:落不了位,不进图
    seen.add(cur.id);
    cur = byId.get(cur.parent);
  }
  return cur === undefined ? null : cur.path;
}

/**
 * 过滤器 + 折叠合一:先挑节点,再丢掉"一端不可见"的边(不留悬空边)。
 * 全部在前端做 —— 数据已经在内存里,零额外 IPC。
 *
 * **链接边单独一列**:统一实体后 `link` 两端是**笔记实体 id**,不是图里的标签节点;
 * 必须按 `kind` 分流(`kept.has` 只用于标签实体边),否则会把力导向 / 强调 / 状态条计数搅脏。
 * 它们不过任何标签过滤器 —— 画不画只取决于「两端笔记是否都在展开的扇形里」(见 `drawPlan`)。
 */
export function applyFilters(
  data: GraphData,
  f: GraphFilters,
): { nodes: GraphNode[]; edges: GraphEdge[]; links: GraphLink[]; empty: boolean } {
  const expanded = new Set(f.axes);
  const nodes = data.nodes.filter((n) => {
    const axis = axisOf(data, n.id);
    if (axis === null) return false;
    const isRoot = n.parent === null;
    if (!isRoot && !expanded.has(axis)) return false; // 未展开的轴:只留根
    if (n.depth > f.maxDepth) return false;
    if (f.onlyWithNotes && n.notes <= 0) return false;
    if (n.notes < f.minNotes) return false;
    return true;
  });
  const kept = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => e.kind !== 'link' && kept.has(e.a) && kept.has(e.b));
  const links = data.edges.filter((e) => e.kind === 'link').map((e) => ({ a: e.a, b: e.b }));
  return { nodes, edges, links, empty: nodes.length === 0 };
}

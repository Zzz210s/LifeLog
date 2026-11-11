// .canvas 生成器（纯函数）：Obsidian Canvas 负责渲染与拖拽，插件只算坐标与写出 JSON。
// 坐标策略：按深度分列（x = 深度 * 320），同列按序号堆叠（y = 序号 * 90）；
// 已有坐标优先保留（用户拖过的不动），只给新节点安排位置。
export type CanvasNode = {
  id: string;
  type: 'file';
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
};

export type CanvasEdge = {
  id: string;
  fromNode: string;
  fromSide: 'right';
  toNode: string;
  toSide: 'left';
  label?: string;
};

export type CanvasDoc = { nodes: CanvasNode[]; edges: CanvasEdge[] };

export type EntityIn = { path: string; parentPath: string | null };
export type RelationIn = { from: string; to: string; name: string };

export const COL_W = 320;
export const ROW_H = 90;
export const NODE_W = 260;
export const NODE_H = 60;

/** 稳定 id：同一路径永远得到同一 id，重生成时用户坐标与连线才不会错位。 */
export function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `${prefix}${(h >>> 0).toString(36)}`;
}

export function buildCanvas(
  entities: EntityIn[],
  relations: RelationIn[],
  existing: Map<string, { x: number; y: number }> = new Map(),
  root = '拾枝',
): CanvasDoc {
  const depthOf = (p: string) => p.split('/').length;
  const sorted = [...entities].sort((a, b) => depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path));

  const rows = new Map<number, number>();
  const nodes: CanvasNode[] = sorted.map((e) => {
    const depth = depthOf(e.path);
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    const id = stableId('n', e.path);
    const keep = existing.get(id);
    return {
      id,
      type: 'file',
      file: `${root}/实体/${e.path}.md`,
      x: keep?.x ?? (depth - 1) * COL_W,
      y: keep?.y ?? row * ROW_H,
      width: NODE_W,
      height: NODE_H,
      color: String((depth % 6) + 1),
    };
  });

  const byPath = new Map(sorted.map((e) => [e.path, stableId('n', e.path)]));
  const edges: CanvasEdge[] = [];

  // 树边：父 → 子
  for (const e of sorted) {
    if (!e.parentPath) continue;
    const from = byPath.get(e.parentPath);
    const to = byPath.get(e.path);
    if (!from || !to) continue;
    edges.push({ id: stableId('e', `${e.parentPath}>${e.path}`), fromNode: from, fromSide: 'right', toNode: to, toSide: 'left' });
  }

  // 关系边：带关系名（Canvas 的 edge 支持 label —— 这正是原生图给不了的）
  for (const r of relations) {
    const from = byPath.get(r.from);
    const to = byPath.get(r.to);
    if (!from || !to) continue;
    edges.push({
      id: stableId('e', `${r.from}|${r.name}|${r.to}`),
      fromNode: from,
      fromSide: 'right',
      toNode: to,
      toSide: 'left',
      label: r.name,
    });
  }

  return { nodes, edges };
}

/** 生成时读出旧文件里已有节点的坐标（保留用户拖动结果）。 */
export function existingPositions(doc: CanvasDoc | null): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>();
  for (const n of doc?.nodes ?? []) m.set(n.id, { x: n.x, y: n.y });
  return m;
}

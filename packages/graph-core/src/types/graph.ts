// graph-core 的类型：与 app 侧 `src/shared/graph-types.ts` 逐字一致（软件与插件共用同一份渲染内核，
// 所以这里不能再引入 app 的业务类型，只能镜像结构）。改这里必须同步改 app 侧，`scripts/check-graph-core.mjs` 会比对。
export interface GraphNode {
  id: number;
  path: string;
  depth: number;
  parent: number | null;
  notes: number;
  selfCount: number;
  sortOrder: number;
}

export interface GraphEdge {
  a: number;
  b: number;
  kind: 'tree' | 'co' | 'link';
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Point {
  x: number;
  y: number;
}

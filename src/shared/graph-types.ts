/**
 * 关系图 DTO(IPC `graph_data` 系列;自 `types.ts` 抽出守 200 行上限,`types.ts` 里 re-export,导入路径不变)。
 * 统一实体后所有 id 都是**实体 id**:树内实体 id `>= 1000000000`、树外实体 id 保持原值,单库内唯一不撞;
 * 但身份只能按边上 `kind` 判,不能靠数值区间猜。
 */

/**
 * 关系图节点(IPC `graph_data`,字段与 Rust `GraphNodeDto` 逐字一致)。
 * `id` 是树内**实体 id**,`parent` 是父节点的**实体 id**(根级为 null),
 * `depth` 是标签树深度(根级 = 1),
 * `notes` 是**含子孙**的去重笔记数(与侧栏 subtree_count 同源),
 * `selfCount` 是本级去重笔记数(不含子孙),`sortOrder` 与 `entities.sort_order` 同口径(右键菜单按它排)。
 */
export interface GraphNode {
  id: number;
  path: string;
  depth: number;
  parent: number | null;
  notes: number;
  selfCount: number;
  sortOrder: number;
}

/** 关系图的边(IPC `graph_data`):`tree` 父子边 / `co` 共现边 / `link` 笔记间已解析链接。
 *  统一实体后 `a`/`b` 都是**实体 id**(树内实体 id `>= 1000000000`、树外实体 id 保持原值,
 *  单库内唯一不撞),但**身份只能按 `kind` 判,不能靠数值区间猜**:`tree`/`co` 两端是树内实体 id,
 *  `link` 两端是树外实体 id(树外节点只在展开时出现,link 边也只在两端都展开时画)。
 *  `weight` 是两端共现笔记数(tree / link 恒为 1)。 */
export interface GraphEdge {
  a: number;
  b: number;
  kind: 'tree' | 'co' | 'link';
  weight: number;
}

/** 树外实体之间的已解析链接(从 `kind: 'link'` 的边上拆出来):两端都是**树外实体 id** */
export interface GraphLink {
  a: number;
  b: number;
}

/** 某标签(含子孙)的出链 / 入链(IPC `graph_link_degrees`;只算已解析且非自指的链接) */
export interface GraphLinkDegrees {
  outbound: number;
  backlinks: number;
}

/** 一次拉全的关系图数据:节点 + 父子边 + 共现边 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

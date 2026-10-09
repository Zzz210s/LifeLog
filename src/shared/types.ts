
/** 信息流读回的一条**实体**(IPC `query_notes`):统一实体后只有一种读 DTO,不再按「笔记 / 标签」分形状;
 *  `id` 是实体 id(与树内实体同属 `entities`),`content` 就是 `entities.meta` 原文(标签词元已剥离)。 */
export interface Note {
  id: number;
  content: string;
  /** 创建时间(物理列,库内 localtime 口径);流里只显示它,不改期、不参与排序与筛选 */
  created_at: string;
  /** 该实体连到的标签**完整路径**集合(树语义真源;根级标签即其名称) */
  tags: string[];
  /** 正文与 `#` 词元的出链(L2):已解析一条也带 targetId/title,null 表示未解析 */
  links: NoteLink[];
}

/** 一条出链(与 Rust `OutboundLink` 逐字一致的 camelCase):rawTitle 是正文原文,
 *  targetId 解析到的目标**实体 id**(未解析 null),title 是目标**当前**显示首行(未解析/已删 null) */
export interface NoteLink {
  rawTitle: string;
  targetId: number | null;
  title: string | null;
}

/** 一条入链(与 Rust `Backlink` 逐字一致的 camelCase):sourceId 是引用来源的**实体 id**,
 *  title 是来源**当前**显示首行(L3 卡片面板/编辑面板列出反向引用用) */
export interface Backlink {
  sourceId: number;
  title: string;
}

/** 单个条目的双向链接(IPC `note_links`):出链按正文出现顺序,入链按来源 id 升序去重 */
export interface NoteLinks {
  outbound: NoteLink[];
  backlinks: Backlink[];
}

/** 全部实体候选池的一项(IPC `complete_notes`,与 Rust `NoteTitle` 逐字一致):id 是**实体 id**(树内 + 树外同一命名空间),
 *  title 是该实体的显示首行(`links::display_title` 口径,只裁首尾空白、大小写原样)。T3.2 起 `#` / `[[ ]]` 共用此池 */
export interface NoteTitle {
  id: number;
  title: string;
}

/** 树内实体(标签树节点)计数:id 是**实体 id**(统一实体表,树内落在偏移区间 `>= 1000000000`),
 *  右键管理(rename/move/delete/tag_impact)、`graph_positions` 位置记忆全按它寻址;
 *  path 为完整路径,self_count 本级链接数,subtree_count 含全部子孙;sort_order 供同层次序(S8,兄弟按 (sort_order, path) 展示) */
export interface TagCount {
  id: number;
  path: string;
  depth: number;
  sort_order: number;
  self_count: number;
  subtree_count: number;
}

/** 删除标签前的二次确认数据:将影响的子孙标签数、去重笔记数与"被多少标签指向" */
export interface TagImpact {
  tags: number;
  notes: number;
  /** 该标签被多少个标签指向(删除确认文案):只数 target_id 就是本标签的直接入边,
   *  不含传递指向,也不含指向子标签的边(删除子树会一并清掉那些,但这里的 N 不统计它们)。 */
  carriers: number;
}

/**
 * # 补全候选项(IPC `complete_tags`):候选池是**树内实体**;kind="tag" 为路径前缀命中,
 * kind="alias" 为别名前缀命中 —— 此时 path 是**别名目标标签的当前路径**
 * (别名存的是指向,目标改名后后端给的就是新路径);
 * kind="similar" 为近义提示项(G4)—— path 是叶子名与词元近似的标签,
 * 采纳行为与标签项一致,只在列表里标注「近似」,绝不自动改写用户输入。
 */
export interface CompleteItem {
  path: string;
  kind: 'tag' | 'alias' | 'similar';
}

/** 合并标签读数(IPC `merge_tags`,camelCase 与 Rust MergeReport 一致) */
export interface MergeReport {
  /** 实际转移的链接行数(目标已有同一笔记链接时被主键挡下,不计入) */
  movedLinks: number;
  /** 合并前挂在源标签上的去重笔记数 */
  affectedNotes: number;
  /** keepAlias 为真时实际登记的别名(旧完整路径在前、旧叶子名在后) */
  aliases: string[];
}

/** 一条标签关系边(IPC `list_tag_relations` / `list_tag_facts`):
 *  读作「本标签具有`remark`所表示的属性,值是 toTagId」;`toTagId` 是标签实体 id(偏移区间),
 *  `remark` 是**边上**的属性名(`A --(国籍)--> B` 的 `国籍`),空串 = 只声明有关系(显示时回退只给目标名) */
export interface RelationRef {
  toTagId: number;
  path: string;
  name: string;
  remark: string;
}

/** 表达式实时校验结果(IPC `validate_expr`);position 是 0 起字符下标,展示时 +1 */
export interface ExprCheck {
  ok: boolean;
  /** 非法时的中文原因(合法为空串) */
  message: string;
  /** 出错字符下标(0 起;与 setSelectionRange 同口径) */
  position: number;
  /** 合法时的中文预览(非法为空串) */
  preview: string;
}

/** 设置页「通用」分区展示的数据库信息(只读) */
export interface DbInfo {
  path: string;  /** 条目数 = `COUNT(*) FROM entities`(笔记与标签同表同权,spec §6.6) */
  entities: number;
}

/**
 * 笔记源码解析结果(IPC `parse_note_source`):与保存路径**共用同一实现**
 * (`tags::extract_tags` + `notes::strip_tags`),是"源码 -> 正文 + 标签集合"的唯一真源。
 * 前端不得另写一份标签语法(那等于把漂移固化)。
 */
export interface ParseResult {
  /** 保存后的正文:标签词元已剥离、行内空白已归一 */
  content: string;
  /** 按首现顺序去重的标签**完整路径** */
  tags: string[];
}

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

/** 筛选条件对象与前端默认值统一从 `filter-conditions.ts` 取(避免两处定义漂移) */
export type { FilterConditions, GroupByCond, TagCond } from './filter-conditions';
export { EMPTY_FILTER } from './filter-conditions';

/**
 * 分组骨架的一项(IPC `group_skeleton`;字段与 Rust `GroupSkeleton` 逐字一致)。
 * `key` = 一级子标签路径,null = 「无该轴标签」哨兵组(恒最后);`label` = 末段名;
 * `count` 是**该组在当前条件下的总数**(不是已加载数);`orderKey` 是组间树序键。
 */
export interface GroupSkeleton {
  key: string | null;
  label: string;
  count: number;
  orderKey: string;
}

/** 骨架结果:`degraded`(组数 > 300,退化为平铺)/ `slow`(聚合 > 200ms,提示加筛选)由后端判定 */
export interface GroupSkeletonResult {
  groups: GroupSkeleton[];
  elapsedMs: number;
  degraded: boolean;
  slow: boolean;
}

/** 一组首屏/续页(IPC `query_grouped` / `query_group_page` 的分组形状) */
export interface GroupPage {
  key: string | null;
  notes: Note[];
}

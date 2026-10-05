
export interface Note {
  id: number;
  content: string;
  /** 创建时间(物理列,库内 localtime 口径);流里只显示它,不改期、不参与排序与筛选 */
  created_at: string;
  /** 标签**完整路径**(树语义真源;根级标签即其名称) */
  tags: string[];
  /** 正文里的出链 `[[X]]`(L2):已解析一条也带 targetId/title,null 表示未解析 */
  links: NoteLink[];
}

/** 一条出链(与 Rust `OutboundLink` 逐字一致的 camelCase):rawTitle 是正文原文,
 *  targetId 解析到的目标 id(未解析 null),title 是目标**当前**显示首行(未解析/已删 null) */
export interface NoteLink {
  rawTitle: string;
  targetId: number | null;
  title: string | null;
}

/** 一条入链(与 Rust `Backlink` 逐字一致的 camelCase):sourceId 是引用来源 id,
 *  title 是来源**当前**显示首行(L3 卡片面板/编辑面板列出反向引用用) */
export interface Backlink {
  sourceId: number;
  title: string;
}

/** 单条笔记的双向链接(IPC `note_links`):出链按正文出现顺序,入链按来源 id 升序去重 */
export interface NoteLinks {
  outbound: NoteLink[];
  backlinks: Backlink[];
}

/** `[[` 补全候选池的一项(IPC `complete_notes`,与 Rust `NoteTitle` 逐字一致):
 *  id + 笔记的显示首行(`links::display_title` 口径,只裁首尾空白、大小写原样) */
export interface NoteTitle {
  id: number;
  title: string;
}

/** 标签树节点计数:id 供右键管理(rename/move/delete/tag_impact 按寻址),
 *  path 为完整路径,self_count 本级链接数,subtree_count 含全部子孙;
 *  sort_order 供同层次序(S8):树里兄弟按 (sort_order, path) 展示 */
export interface TagCount {
  id: number;
  path: string;
  depth: number;
  sort_order: number;
  self_count: number;
  subtree_count: number;
}

/** 删除标签前的二次确认数据:将影响的子孙标签数、去重笔记数与"被多少标签携带" */
export interface TagImpact {
  tags: number;
  notes: number;
  /** 该标签被多少个标签携带(删除确认文案):只数 target_id 就是本标签的直接携带者,
   *  不含传递携带,也不含指向子标签的携带行(删除子树会一并清掉那些,但这里的 N 不统计它们)。 */
  carriers: number;
}

/**
 * # 补全候选项(IPC `complete_tags`):kind="tag" 为标签路径前缀命中,
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

/** 携带 / 被携带方向上的一个标签(id + 完整路径,IPC `list_tag_carries`) */
export interface TagRef {
  id: number;
  path: string;
}

/** 双向携带读数(IPC `list_tag_carries`,camelCase 与 Rust CarryReport 一致):
 *  carried 是本标签携带的;carriersOf 是携带本标签的 */
export interface CarryReport {
  carried: TagRef[];
  carriersOf: TagRef[];
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
  path: string;
  notes: number;
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
 * `depth` 是标签树深度(根级 = 1),`parent` 是父标签 id(根级为 null),
 * `notes` 是**含子孙**的去重笔记数(与侧栏 subtree_count 同源),
 * `selfCount` 是本级去重笔记数(不含子孙),`sortOrder` 与 `tags.sort_order` 同口径(右键菜单按它排)。
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
 *  `tree`/`co` 的 `a`/`b` 是**标签 id**;`link` 的 `a`/`b` 是**笔记 id**(两套 id 不同命名空间,
 *  消费者必须先按 `kind` 分流 —— 笔记节点只在展开时出现,link 边也只在两端笔记都展开时画)。
 *  `weight` 是两端共现笔记数(tree / link 恒为 1)。 */
export interface GraphEdge {
  a: number;
  b: number;
  kind: 'tree' | 'co' | 'link';
  weight: number;
}

/** 笔记间已解析链接(从 `kind: 'link'` 的边上拆出来):两端都是笔记 id */
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
export type { FilterConditions, TagCond } from './filter-conditions';
export { EMPTY_FILTER } from './filter-conditions';

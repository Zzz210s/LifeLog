import type { FilterConditions } from './filter-conditions';

export interface Note {
  id: number;
  content: string;
  /** 创建时间(物理列,库内 localtime 口径);流里只显示它,不改期、不参与排序与筛选 */
  created_at: string;
  /** 标签**完整路径**(树语义真源;根级标签即其名称) */
  tags: string[];
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

/** 删除标签前的二次确认数据:将影响的子孙标签数与去重笔记数 */
export interface TagImpact {
  tags: number;
  notes: number;
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

/** 筛选条件对象与前端默认值统一从 `filter-conditions.ts` 取(避免两处定义漂移) */
export type { FilterConditions, TagCond } from './filter-conditions';
export { EMPTY_FILTER } from './filter-conditions';

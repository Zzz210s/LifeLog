import type { FilterConditions } from './filter-conditions';

export interface Note {
  id: number;
  content: string;
  /** 物理列保留,但已不参与显示/排序/筛选/导出(时间一律看 `date`) */
  created_at: string;
  /** 时间标签的日期(`YYYY-MM-DD`,来自 `时间排序/Y/M/D`);无时间标签为 null */
  date: string | null;
  /** 时间标签节点 id(改期时按 id 重新链接);无时间标签为 null */
  date_tag_id: number | null;
  /** 标签**完整路径**(树语义真源;根级标签即其名称) */
  tags: string[];
}

/** 标签树节点计数:id 供右键管理(rename/move/delete/tag_impact 按寻址),
 *  path 为完整路径,self_count 本级链接数,subtree_count 含全部子孙 */
export interface TagCount {
  id: number;
  path: string;
  depth: number;
  self_count: number;
  subtree_count: number;
}

/** 删除标签前的二次确认数据:将影响的子孙标签数与去重笔记数 */
export interface TagImpact {
  tags: number;
  notes: number;
}

/** 自建保存视图(内置视图是代码常量不入表;字段 snake_case 直传,同 Note 惯例) */
export interface SavedView {
  id: number;
  title: string;
  conditions: FilterConditions;
  sort_order: number;
  created_at: string;
  /** 表达式引用但当前库中已不存在的标签路径(无表达式/无失效时为空数组;Task 6 才展示) */
  broken_paths: string[];
}

/** 设置页「通用」分区展示的数据库信息(只读) */
export interface DbInfo {
  path: string;
  notes: number;
}

/** 筛选条件对象与前端默认值统一从 `filter-conditions.ts` 取(避免两处定义漂移) */
export type { FilterConditions, TagCond } from './filter-conditions';
export { EMPTY_FILTER } from './filter-conditions';

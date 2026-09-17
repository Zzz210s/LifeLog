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

/** 自建保存视图(内置视图是代码常量不入表;字段 snake_case 直传,同 Note 惯例) */
export interface SavedView {
  id: number;
  title: string;
  conditions: FilterConditions;
  sort_order: number;
  created_at: string;
  /** 图标名(lucide 组件名,如 inbox);null = 无图标(见 main-window/view-icons.tsx 白名单) */
  icon: string | null;
  /** 表达式引用但当前库中已不存在的标签路径(无表达式/无失效时为空数组;侧栏用行内提示标记) */
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

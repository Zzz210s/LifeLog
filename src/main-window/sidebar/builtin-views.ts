/**
 * 内置视图前端常量(spec 4:内置视图是代码常量,不入 saved_views 表)。
 * 条件对象与 Rust `db/repos/views.rs` 的 conditions_of_builtin 保持镜像:
 * 全部 = 空条件;待办 = 引入 `todo` 精确 + 排除 `done` 精确;无自定义标签 = tagPresence none。
 */
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions, TagCond } from '../../shared/filter-conditions';

export interface BuiltinView {
  key: 'all' | 'todo' | 'untagged';
  title: string;
  /** 固定图标名(前端常量,不入库、不可编辑;spec 4:内置三视图图标固定) */
  icon: string;
  conditions: FilterConditions;
}

/** 精确匹配(不含子级),与 Rust exact 闭包一致 */
const exact = (path: string): TagCond => ({ path, includeChildren: false });

export const BUILTIN_VIEWS: BuiltinView[] = [
  { key: 'all', title: '全部', icon: 'inbox', conditions: EMPTY_FILTER },
  {
    key: 'todo',
    title: '待办',
    icon: 'list-checks',
    conditions: {
      ...EMPTY_FILTER,
      tags: [exact('todo')],
      excludeTags: [exact('done')],
    },
  },
  // 语义是“除时间标签外无标签”(时间标签是系统元数据),故标题用「无自定义标签」
  { key: 'untagged', title: '无自定义标签', icon: 'tags', conditions: { ...EMPTY_FILTER, tagPresence: 'none' } },
];

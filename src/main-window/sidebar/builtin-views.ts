/**
 * 内置视图前端常量(spec 4:内置视图是代码常量,不入 saved_views 表)。
 * 条件对象与 Rust `db/repos/views.rs` 的 conditions_of_builtin 保持镜像:
 * 全部 = 空条件;待办 = 引入 `todo` 精确 + 排除 `done` 精确;无标签 = tagPresence none。
 */
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions, TagCond } from '../../shared/filter-conditions';

export interface BuiltinView {
  key: 'all' | 'todo' | 'untagged';
  title: string;
  conditions: FilterConditions;
}

/** 精确匹配(不含子级),与 Rust exact 闭包一致 */
const exact = (path: string): TagCond => ({ path, includeChildren: false });

export const BUILTIN_VIEWS: BuiltinView[] = [
  { key: 'all', title: '全部', conditions: EMPTY_FILTER },
  {
    key: 'todo',
    title: '待办',
    conditions: {
      ...EMPTY_FILTER,
      tags: [exact('todo')],
      excludeTags: [exact('done')],
    },
  },
  { key: 'untagged', title: '无标签', conditions: { ...EMPTY_FILTER, tagPresence: 'none' } },
];

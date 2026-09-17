/**
 * 内置视图前端常量(spec 4:内置视图是代码常量,不入 saved_views 表)。
 * 条件对象与 Rust `db/repos/views.rs` 的 conditions_of_builtin 保持镜像(D7):
 * 全部 = 空条件;待办 = 引入 `待办`(含子级,S5 起不再排除已删除的 `done`);
 * 无自定义标签 = 无任何标签(tagPresence none;时间标签已不再是例外)。
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

/** 含子级(自身 + 全部子孙) */
const withChildren = (path: string): TagCond => ({ path, includeChildren: true });

export const BUILTIN_VIEWS: BuiltinView[] = [
  { key: 'all', title: '全部', icon: 'inbox', conditions: EMPTY_FILTER },
  {
    key: 'todo',
    title: '待办',
    icon: 'list-checks',
    conditions: {
      ...EMPTY_FILTER,
      tags: [withChildren('待办')],
    },
  },
  // 语义是“没有任何标签”(时间标签也计入),标题仍是历史名「无自定义标签」
  { key: 'untagged', title: '无自定义标签', icon: 'tags', conditions: { ...EMPTY_FILTER, tagPresence: 'none' } },
];


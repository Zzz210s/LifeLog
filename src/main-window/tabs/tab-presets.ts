/**
 * 标签页的三个预设(spec 2026-09-17 S6/S7):全部 / 待办 / 无标签。
 * 预设是前端代码常量(不入库、不做图标/排序字段、不分享),点标签页栏的「+」菜单即按它的
 * 条件开一个标签页。判定条件与查询语义一字未改(条件对象见 shared/filter-conditions,
 * 后端唯一权威见 Rust `db/repos/notes_filter.rs`)。
 */
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions, TagCond } from '../../shared/filter-conditions';

export type PresetKey = 'all' | 'todo' | 'untagged';

export interface TabPreset {
  key: PresetKey;
  /** 菜单里的中文名(标签页标题仍由条件自动生成,除非用户改名) */
  title: string;
  conditions: FilterConditions;
}

/** 含子级(自身 + 全部子孙) */
const withChildren = (path: string): TagCond => ({ path, includeChildren: true });

export const TAB_PRESETS: TabPreset[] = [
  { key: 'all', title: '全部', conditions: EMPTY_FILTER },
  {
    key: 'todo',
    title: '待办',
    conditions: { ...EMPTY_FILTER, tags: [withChildren('待办')] },
  },
  // 语义是"没有任何标签"(时间标签也计入)
  { key: 'untagged', title: '无标签', conditions: { ...EMPTY_FILTER, tagPresence: 'none' } },
];

/** 按 key 取预设(未知 key 是编程错误,直接抛,不静默回落) */
export function presetByKey(key: PresetKey): TabPreset {
  const found = TAB_PRESETS.find((p) => p.key === key);
  if (!found) throw new Error('未知的标签页预设: ' + key);
  return found;
}

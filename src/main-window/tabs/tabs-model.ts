/**
 * 标签页数据模型(spec 2026-09-17 S7):一个标签页 = 一套筛选条件快照 + 标题。
 * 标题为空串表示"用自动标题"(见 auto-title.ts);明确不做图标、排序字段与分享。
 * 本文件只有纯函数(便于单测);读写 settings 的副作用在 use-tabs.ts。
 * 落库形状(与 Rust `db/repos/tabs_rewrite.rs` 共用同一份约定):
 *   {"tabs":[{"title":"","conditions":{...}}],"activeIndex":0}
 */
import { EMPTY_FILTER, filterKey } from '../../shared/filter-conditions';
import { parseFilterJson } from '../../shared/filter-conditions-parse';
import type { FilterConditions } from '../../shared/filter-conditions';
import { autoTitle } from './auto-title';

/** settings 键(真源在 Rust `db/repos/settings.rs` 的 TABS_STATE_KEY) */
export const TABS_KEY = 'tabs_state';

export interface Tab {
  /** 用户改的名字;空串 = 自动标题 */
  title: string;
  conditions: FilterConditions;
}

export interface TabsState {
  tabs: Tab[];
  activeIndex: number;
}

/** 默认状态:单个「全部」页(键缺失/损坏时的退化目标) */
export function defaultTabs(): TabsState {
  return { tabs: [{ title: '', conditions: { ...EMPTY_FILTER } }], activeIndex: 0 };
}

/** 标签页显示名:有用户标题用标题,否则按条件自动生成 */
export function tabLabel(tab: Tab): string {
  const title = tab.title.trim();
  return title !== '' ? title : autoTitle(tab.conditions);
}

/** 当前活动页的条件(整个应用的条件真源) */
export function activeConditions(s: TabsState): FilterConditions {
  return s.tabs[s.activeIndex].conditions;
}

/**
 * 解析持久化的 tabs_state:空串/坏 JSON/缺 tabs/坏条目一律退化 ——
 * 至少留一个「全部」页,绝不把半成品状态放进状态机。
 * 单个条目缺 conditions 或条件非法时按 EMPTY_FILTER 归一(与旧 filter_last 同一套解析器)。
 */
export function parseTabsState(raw: string | null): TabsState {
  if (raw === null || raw.trim() === '') return defaultTabs();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaultTabs();
  }
  if (!isRecord(data) || !Array.isArray(data.tabs)) return defaultTabs();
  const tabs: Tab[] = [];
  for (const item of data.tabs) {
    if (!isRecord(item)) continue; // 非对象条目:丢弃
    const title = typeof item.title === 'string' ? item.title : '';
    const conditions = parseFilterJson(JSON.stringify(item.conditions ?? null));
    tabs.push({ title, conditions });
  }
  if (tabs.length === 0) return defaultTabs();
  const idx = data.activeIndex;
  const activeIndex = typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < tabs.length
    ? idx
    : 0;
  return { tabs, activeIndex };
}

/** 序列化为落库文本(只写约定字段,未知字段一律不落地) */
export function serializeTabsState(s: TabsState): string {
  return JSON.stringify({
    tabs: s.tabs.map((t) => ({ title: t.title, conditions: t.conditions })),
    activeIndex: s.activeIndex,
  });
}

/** 追加一页(条件先归一);新页成为当前页 */
export function addTab(s: TabsState, conditions: FilterConditions, title = ''): TabsState {
  const tab: Tab = { title, conditions: parseFilterJson(JSON.stringify(conditions)) };
  return { tabs: [...s.tabs, tab], activeIndex: s.tabs.length };
}

/** 条件值相等的页下标(filterKey 口径),没有返回 -1 */
export function findTab(s: TabsState, conditions: FilterConditions): number {
  const key = filterKey(conditions);
  return s.tabs.findIndex((t) => filterKey(t.conditions) === key);
}

/**
 * 关闭一页:至少保留一个 —— 关掉最后一页时留一个「全部」新页。
 * 关掉当前页时选中紧邻的下一页(VSCode 口径),否则活动页跟着自己走。
 */
export function closeTab(s: TabsState, index: number): TabsState {
  if (index < 0 || index >= s.tabs.length) return s;
  if (s.tabs.length === 1) return defaultTabs();
  const active = s.tabs[s.activeIndex];
  const tabs = s.tabs.filter((_, i) => i !== index);
  const activeIndex = index === s.activeIndex
    ? Math.min(index, tabs.length - 1)
    : Math.max(0, tabs.indexOf(active));
  return { tabs, activeIndex };
}

/** 拖拽重排:把 from 挪到 to 的位置;选中页跟着它自己(new tab 位置)走 */
export function moveTab(s: TabsState, from: number, to: number): TabsState {
  if (from === to || from < 0 || to < 0 || from >= s.tabs.length || to >= s.tabs.length) return s;
  const active = s.tabs[s.activeIndex];
  const tabs = [...s.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return { tabs, activeIndex: Math.max(0, tabs.indexOf(active)) };
}

/** 改名:空标题存空串(显示时回退为自动标题) */
export function renameTab(s: TabsState, index: number, title: string): TabsState {
  if (index < 0 || index >= s.tabs.length) return s;
  const tabs = s.tabs.map((t, i) => (i === index ? { ...t, title: title.trim() } : t));
  return { ...s, tabs };
}

/** 切换到某页(越界不动) */
export function activateTab(s: TabsState, index: number): TabsState {
  return index >= 0 && index < s.tabs.length ? { ...s, activeIndex: index } : s;
}

/** 局部更新当前页的条件(浅合并,与旧 filter_last 的 patch 语义一致) */
export function patchActive(s: TabsState, value: Partial<FilterConditions>): TabsState {
  const index = s.activeIndex;
  const tabs = s.tabs.map((t, i) => (i === index ? { ...t, conditions: { ...t.conditions, ...value } } : t));
  return { ...s, tabs };
}

/** 当前页标签选中开关:未选中则加入(默认"含子级"),已选中则移除 */
export function toggleActiveTag(s: TabsState, path: string): TabsState {
  const current = activeConditions(s);
  const has = current.tags.some((t) => t.path === path);
  const tags = has
    ? current.tags.filter((t) => t.path !== path)
    : [...current.tags, { path, includeChildren: true }];
  return patchActive(s, { tags });
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 排序条件的纯函数真源(设计 2026-10-06 §4):UI 不各自写死方向文案与去重口径。
 * 全部在这里 = React 组件只做渲染与事件接线,便于单测;`sorts` 数组下标即优先级。
 */
import { MAX_SORT_CONDS, sortsFromLegacy } from '../../shared/filter-conditions';
import type { SortCond, SortDir } from '../../shared/filter-conditions';
import { tagLabelPlain } from '../../shared/tag-label';

/** 排序条目的唯一键:kind + path(方向与启用态不参与 —— 同一轴不允许两条) */
export const sortCondKey = (c: SortCond): string => (c.kind === 'tag' ? `tag:${c.path}` : 'time');

/** 维度名:时间 / 标签轴路径(显示口径走 tagLabelPlain,与 chip 一致) */
export const sortAxisLabel = (c: SortCond): string =>
  c.kind === 'time' ? '时间' : tagLabelPlain(c.path);

/** 方向文案(设计 §4.4 表):时间 = 新 -> 旧 / 旧 -> 新;标签轴 = 选项顺序 / 选项倒序 */
export function dirLabel(c: SortCond): string {
  if (c.kind === 'time') return c.dir === 'desc' ? '新 -> 旧' : '旧 -> 新';
  return c.dir === 'asc' ? '选项顺序' : '选项倒序';
}

/** chip 文案:`排序: 新 -> 旧` / `排序: 地点 选项顺序` */
export const sortChipLabel = (c: SortCond): string =>
  c.kind === 'time' ? `排序: ${dirLabel(c)}` : `排序: ${sortAxisLabel(c)} ${dirLabel(c)}`;

/** 提示行文案(设计 §4.7):取第一条启用项;无启用项沿用「最新在前」 */
export function sortHintLabel(sorts: SortCond[]): string {
  const first = sorts.find((s) => s.enabled);
  if (first === undefined) return '最新在前';
  if (first.kind === 'time') return first.dir === 'asc' ? '最早在前' : '最新在前';
  return `${sortAxisLabel(first)} ${dirLabel(first)}`;
}

/** 该轴是否已在列表里(去重判据) */
export const hasSortAxis = (sorts: SortCond[], c: SortCond): boolean =>
  sorts.some((s) => sortCondKey(s) === sortCondKey(c));

/** 追加一条:同轴已有或到上限则原样返回(保持数组引用不变,便于调用方判等/禁用) */
export function addSort(sorts: SortCond[], c: SortCond): SortCond[] {
  if (sorts.length >= MAX_SORT_CONDS || hasSortAxis(sorts, c)) return sorts;
  return [...sorts, c];
}

/** 勾选 / 停用某条(只重建该条引用) */
export const toggleSort = (sorts: SortCond[], index: number): SortCond[] =>
  sorts.map((s, i) => (i === index ? { ...s, enabled: !s.enabled } : s));

/** 改方向(不换维度语义:时间就改时间、标签就改标签) */
export const setSortDir = (sorts: SortCond[], index: number, dir: SortDir): SortCond[] =>
  sorts.map((s, i) => (i === index ? { ...s, dir } : s));

/** 上移 / 下移(delta = -1 / +1),越界原样返回;这是键盘可达的优先级调整通道 */
export function moveSort(sorts: SortCond[], index: number, delta: number): SortCond[] {
  const to = index + delta;
  if (index < 0 || index >= sorts.length || to < 0 || to >= sorts.length) return sorts;
  const next = sorts.slice();
  const item = next[index];
  next.splice(index, 1);
  next.splice(to, 0, item as SortCond);
  return next;
}

/** 删除某条 */
export const removeSort = (sorts: SortCond[], index: number): SortCond[] =>
  sorts.filter((_, i) => i !== index);

/** 一键复位:清空多条件,设为单条时间排序(newest -> 空数组 = 有效时间降序) */
export const resetSorts = sortsFromLegacy;

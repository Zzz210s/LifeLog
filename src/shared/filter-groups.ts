/**
 * 条件组的**就地变更** helper(模型的类型 / 归一 / 闸门在 `filter-groups-core.ts`,本件再出口,
 * 保证既有 import 路径 `./filter-groups` 不变)。每个 helper 都先过 `migrateFlat` 搬平铺,
 * 只改 `groups`/`groupOp` 一处;「组变空也保留组头」是刻意选择(组头还在才能继续往里加条件)。
 */
import type { FilterConditions } from './filter-conditions';
import type { GroupItem, GroupOp } from './filter-groups-core';
import { migrateFlat } from './filter-groups-core';

export type { FilterGroup, GroupItem, GroupOp } from './filter-groups-core';
export {
  allItems,
  flatItemsOf,
  hasGroups,
  isBlankItem,
  migrateFlat,
  normalizeGroups,
  opOf,
  uiGroups,
} from './filter-groups-core';

/** 删除第 gi 组的第 ii 项(组变空也保留:组头还在,可继续往里加)
 *  索引口径 = `migrateFlat` 后的 `groups`(与 `uiGroups` 一致) */
export function removeGroupItem(c: FilterConditions, gi: number, ii: number): FilterConditions {
  const m = migrateFlat(c);
  return {
    ...m,
    groups: m.groups.map((g, x) => (x === gi ? { ...g, items: g.items.filter((_, y) => y !== ii) } : g)),
  };
}

/** 删除整个组 */
export function removeGroup(c: FilterConditions, gi: number): FilterConditions {
  const m = migrateFlat(c);
  return { ...m, groups: m.groups.filter((_, x) => x !== gi) };
}

/** 新建一个空组(界面上先出组头,再往里加条件) */
export function addGroup(c: FilterConditions, op: GroupOp = 'and'): FilterConditions {
  const m = migrateFlat(c);
  return { ...m, groups: [...m.groups, { op, items: [] }] };
}

/** 改某一组的组内 op */
export function setGroupOp(c: FilterConditions, gi: number, op: GroupOp): FilterConditions {
  const m = migrateFlat(c);
  return { ...m, groups: m.groups.map((g, x) => (x === gi ? { ...g, op } : g)) };
}

/** 改组间 op */
export function setGlobalGroupOp(c: FilterConditions, op: GroupOp): FilterConditions {
  return { ...migrateFlat(c), groupOp: op };
}

/** 把一个项追加到第 `group` 组(越界 -> 新建一组 op='and');组内同 `kind`+`path` 已存在时原样返回,
 * 保证选择器重复落笔幂等。返回对象已搬平铺(空组保留)。
 */
export function addGroupItem(c: FilterConditions, item: GroupItem, group = 0): FilterConditions {
  const m = migrateFlat(c);
  const dup = (it: GroupItem): boolean => {
    if (it.kind !== item.kind) return false;
    if (it.kind === 'tag' || it.kind === 'excludeTag' || it.kind === 'relation' || it.kind === 'excludeRelation') {
      return (it as { path: string }).path === (item as { path: string }).path;
    }
    return false; // 关键词/有无标签/表达式不做去重(它们不来自路径选择器)
  };
  const target = m.groups[group];
  if (target !== undefined && target.items.some(dup)) return m;
  if (target === undefined) {
    return { ...m, groups: [...m.groups, { op: 'and', items: [item] }] };
  }
  return {
    ...m,
    groups: m.groups.map((g, x) => (x === group ? { ...g, items: [...g.items, item] } : g)),
  };
}

/** 对第 `group` 组的 items 做整体替换(`fn(items) -> nextItems`);该组不存在且结果非空时新建一组 */
export function mapGroupItems(
  c: FilterConditions,
  group: number,
  fn: (items: GroupItem[]) => GroupItem[]
): FilterConditions {
  const m = migrateFlat(c);
  if (group >= m.groups.length) {
    const items = fn([]);
    return items.length === 0 ? m : { ...m, groups: [...m.groups, { op: 'and', items }] };
  }
  return {
    ...m,
    groups: m.groups.map((g, x) => (x === group ? { ...g, items: fn(g.items) } : g)),
  };
}

/** 全组里指定 kind 的路径(侧栏高亮 / 选中态读用;OR 结构下取并集) */
export function itemPaths(c: FilterConditions, kind: GroupItem['kind']): string[] {
  const out: string[] = [];
  for (const g of migrateFlat(c).groups) {
    for (const it of g.items) {
      if (it.kind === kind && 'path' in it) out.push(it.path);
    }
  }
  return out;
}

/** 从全组里删掉指定 kind + path 的项(组变空也保留组头) */
export function removePathItems(
  c: FilterConditions,
  kind: GroupItem['kind'],
  path: string
): FilterConditions {
  const m = migrateFlat(c);
  return {
    ...m,
    groups: m.groups.map((g) => ({
      ...g,
      items: g.items.filter((it) => !(it.kind === kind && 'path' in it && it.path === path)),
    })),
  };
}

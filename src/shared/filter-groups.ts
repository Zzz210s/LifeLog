/**
 * 条件组模型(设计 2026-10-06 §5):组内 `op` 每组独立、组间一个 `groupOp`,只有两级、不做任意深度嵌套。
 * `normalizeGroups` 是本仓「一种形态」的唯一闸门:旧 8 个平铺字段在归一里搬进 `groups[0]`(op='and')
 * 并清空,空组(含全空白项)丢弃;此后编译 / 落库 / 级联只认 `groups`。
 * 与 Rust `db/repos/notes_filter_groups.rs` 同构,JSON 字段名一一对应(serde tag = `kind`)。
 */
import type { FilterConditions } from './filter-conditions';

export type GroupOp = 'and' | 'or';

/** 组内一项 = 现有结构化条件的一种(同一批原语,不新增语义) */
export type GroupItem =
  | { kind: 'keyword'; value: string }
  | { kind: 'tag'; path: string; includeChildren: boolean }
  | { kind: 'excludeTag'; path: string; includeChildren: boolean }
  | { kind: 'relation'; path: string }
  | { kind: 'excludeRelation'; path: string }
  | { kind: 'presence'; value: 'any' | 'none' }
  | { kind: 'expr'; value: string };

export interface FilterGroup {
  /** 组内关系:每组独立 */
  op: GroupOp;
  items: GroupItem[];
}

/** 非法/缺省一律回落 `and`(与 Rust 归一同一口径) */
export const opOf = (v: unknown): GroupOp => (v === 'or' ? 'or' : 'and');

/** 空白项(关键词/表达式只看 trim 后有无内容);Rust 侧编译时同样跳过 */
export function isBlankItem(it: GroupItem): boolean {
  return (it.kind === 'keyword' || it.kind === 'expr') && it.value.trim() === '';
}

/** 旧平铺字段展开成组内项(顺序 = 旧 `where_clause` 口径:关键词、标签、排除、关系、排除关系、有无标签、表达式) */
export function flatItemsOf(c: FilterConditions): GroupItem[] {
  const items: GroupItem[] = [];
  if ((c.keyword ?? '').trim() !== '') items.push({ kind: 'keyword', value: c.keyword as string });
  for (const t of c.tags ?? []) {
    items.push({ kind: 'tag', path: t.path, includeChildren: t.includeChildren });
  }
  for (const t of c.excludeTags ?? []) {
    items.push({ kind: 'excludeTag', path: t.path, includeChildren: t.includeChildren });
  }
  for (const r of c.relations ?? []) items.push({ kind: 'relation', path: r.path });
  for (const r of c.excludeRelations ?? []) items.push({ kind: 'excludeRelation', path: r.path });
  if (c.tagPresence === 'any' || c.tagPresence === 'none') {
    items.push({ kind: 'presence', value: c.tagPresence });
  }
  if ((c.expr ?? '').trim() !== '') items.push({ kind: 'expr', value: c.expr as string });
  return items;
}

/**
 * 只搬平铺、**保留空组**(界面渲染与就地变更用:空组也要有组头,才能往里继续加条件)。
 * 空组丢弃只发生在查询 / 落库 / 命中数前的 `normalizeGroups`。
 */
export function migrateFlat(c: FilterConditions): FilterConditions {
  const flat = flatItemsOf(c);
  const raw: FilterGroup[] = (Array.isArray(c.groups) ? c.groups : []).map((g) => ({
    op: opOf(g?.op),
    items: (Array.isArray(g?.items) ? g.items : []).filter((it) => it != null && !isBlankItem(it)),
  }));
  return {
    ...c,
    keyword: null,
    tags: [],
    excludeTags: [],
    relations: [],
    excludeRelations: [],
    tagPresence: null,
    expr: null,
    groupOp: opOf(c.groupOp),
    groups: flat.length > 0 ? [{ op: 'and', items: flat }, ...raw] : raw,
  };
}

/**
 * 归一(幂等):平铺字段非空 -> 前插成 `groups[0]`(op='and');空组丢弃;平铺字段清空。
 * 前插而非并入 `groups[0]`:后者在 `groups[0].op==='or'` 时会改变旧条件的语义(AND 变 OR)。
 */
export function normalizeGroups(c: FilterConditions): FilterConditions {
  const m = migrateFlat(c);
  return { ...m, groups: m.groups.filter((g) => g.items.length > 0) };
}

/** 界面用的组列表(保留空组;索引与 `migrateFlat` 后的 `groups` 一致) */
export function uiGroups(c: FilterConditions): FilterGroup[] {
  return migrateFlat(c).groups;
}

/** 全组项展平(摘要 / 本地重判用;保留顺序) */
export function allItems(c: FilterConditions): GroupItem[] {
  return normalizeGroups(c).groups.flatMap((g) => g.items);
}

/** 是否有收窄条件(归一后没有组 = 空) */
export function hasGroups(c: FilterConditions): boolean {
  return normalizeGroups(c).groups.length > 0;
}

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

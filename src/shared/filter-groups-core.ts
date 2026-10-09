/**
 * 条件组模型与归一(自 `filter-groups.ts` 拆出,守 200 行上限):组内 `op` 每组独立、组间一个
 * `groupOp`,只有两级、不做任意深度嵌套。`normalizeGroups` 是本仓「一种形态」的唯一闸门:
 * 旧 8 个平铺字段在归一里搬进 `groups[0]`(op='and')并清空,空组(含全空白项)丢弃;
 * 此后编译 / 落库 / 级联只认 `groups`。就地变更 helper 留在 `filter-groups.ts`(那里再出口)。
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
  /** 在树内 / 不在树内(判定 = 渲染闭包,spec §4.1 / §10-P2) */
  | { kind: 'treeMembership'; value: 'in' | 'out' }
  /** `meta` 单行 / 多行 */
  | { kind: 'singleLine'; value: 'single' | 'multi' }
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

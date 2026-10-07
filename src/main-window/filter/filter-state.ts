/**
 * 单份筛选条件的持久化(spec 2026-09-25 §2;条件组化 2026-10-06 §5):settings 键 `filter_current`。
 * 键名真源在 Rust `db/repos/settings.rs` 的 `FILTER_CURRENT_KEY`,这里是它的镜像常量。
 * 落库形状 = `{ groupOp, groups, sort, sorts }` —— **只写新字段**,旧平铺字段不再落库(单向迁移)。
 * 本文件只有纯函数(便于单测);读写 settings 的副作用在 use-filter-state.ts。
 */
import {
  EMPTY_FILTER,
  addGroupItem,
  mapGroupItems,
  normalizeGroups,
  removePathItems,
  sortMirror,
  sortsFromLegacy,
} from '../../shared/filter-conditions';
import type { FilterConditions, GroupItem, SortCond } from '../../shared/filter-conditions';
import { parseFilterJson } from '../../shared/filter-conditions-parse';
import { applyTagPick } from './filter-chips';

/** settings 键(真源在 Rust `db/repos/settings.rs` 的 FILTER_CURRENT_KEY) */
export const FILTER_KEY = 'filter_current';

/** 默认条件:空条件(键缺失/坏值时的退化目标) */
export function defaultFilterState(): FilterConditions {
  return { ...EMPTY_FILTER };
}

/**
 * 解析持久化的 filter_current:空串/坏 JSON/非法条件一律退化为空条件 ——
 * 解析与归一完全复用 shared 的 parseFilterJson,不在这里维护第二套口径。
 * **返回副本**:parseFilterJson 在退化路径上会直接返回模块级的 `EMPTY_FILTER` 常量本身。
 */
export function parseFilterState(raw: string | null): FilterConditions {
  return { ...parseFilterJson(raw) };
}

/** 排序列序列化:友类型联合原样落库(kind/dir/enabled,标签轴额外带 path) */
const serializeSort = (s: SortCond) =>
  s.kind === 'tag' ? { kind: s.kind, path: s.path, dir: s.dir, enabled: s.enabled } : { ...s };

/** 条件组序列化:item 形状已与落库一致(kind 判别联合) */
const serializeGroup = (g: FilterConditions['groups'][number]) => ({
  op: g.op,
  items: g.items.map((it) => ({ ...it })),
});

/** 序列化为落库文本:只写 `groupOp` / `groups` / `sort` / `sorts`(平铺字段不再写) */
export function serializeFilterState(c: FilterConditions): string {
  const n = normalizeGroups(c);
  return JSON.stringify({
    groupOp: n.groupOp,
    groups: n.groups.map(serializeGroup),
    sort: sortMirror(n.sorts),
    sorts: n.sorts.map(serializeSort),
  });
}

/** 平铺字段名(旧调用点的降级通道:补丁带这些且不带 groups 时并入第 0 组) */
const FLAT_FIELDS = [
  'keyword',
  'tags',
  'excludeTags',
  'relations',
  'excludeRelations',
  'tagPresence',
  'expr',
] as const;

/** 按种类整段替换(保持该 kind 原位置;没有则追加到末尾) */
function replaceKind(items: GroupItem[], kind: GroupItem['kind'], next: GroupItem[]): GroupItem[] {
  const firstIdx = items.findIndex((it) => it.kind === kind);
  const rest = items.filter((it) => it.kind !== kind);
  if (next.length === 0) return rest;
  if (firstIdx < 0) return [...rest, ...next];
  const before = items.slice(0, firstIdx).filter((it) => it.kind !== kind);
  return [...before, ...next, ...rest.slice(before.length)];
}

/**
 * 旧平铺字段补丁并入第 0 组(设计与 `normalizeGroups` 的「搬进 groups[0]」同义,
 * 但用于**在线补丁**而不是回读:关键字/表达式/有无标签按种类唯一,标签/关系整段替换)。
 * 顺序按旧 `where_clause` 口径,保证 chip 与摘要的次序不变。
 */
function applyFlatPatch(c: FilterConditions, v: Partial<FilterConditions>): FilterConditions {
  const tagItems = (list: { path: string; includeChildren: boolean }[] | undefined, kind: GroupItem['kind']) =>
    (list ?? []).map((t) => ({ kind, path: t.path, includeChildren: t.includeChildren }) as GroupItem);
  const pathItems = (list: { path: string }[] | undefined, kind: GroupItem['kind']) =>
    (list ?? []).map((r) => ({ kind, path: r.path }) as GroupItem);
  return mapGroupItems(c, 0, (start) => {
    let items = start;
    if (v.keyword !== undefined) {
      const kw = v.keyword ?? '';
      items = replaceKind(items, 'keyword', kw.trim() === '' ? [] : [{ kind: 'keyword', value: kw }]);
    }
    if (v.tags !== undefined) items = replaceKind(items, 'tag', tagItems(v.tags, 'tag'));
    if (v.excludeTags !== undefined) items = replaceKind(items, 'excludeTag', tagItems(v.excludeTags, 'excludeTag'));
    if (v.relations !== undefined) items = replaceKind(items, 'relation', pathItems(v.relations, 'relation'));
    if (v.excludeRelations !== undefined) {
      items = replaceKind(items, 'excludeRelation', pathItems(v.excludeRelations, 'excludeRelation'));
    }
    if (v.tagPresence !== undefined) {
      const tp = v.tagPresence;
      items = replaceKind(items, 'presence', tp === null ? [] : [{ kind: 'presence', value: tp }]);
    }
    if (v.expr !== undefined) {
      const ex = v.expr ?? '';
      items = replaceKind(items, 'expr', ex.trim() === '' ? [] : [{ kind: 'expr', value: ex }]);
    }
    return items;
  });
}

/**
 * 落态兼容(设计 §4.2/§5.2):
 * - patch 带 `groups`(新形态,含 chip 移除整对象透传)时以它为准,平铺字段一律忽略;
 * - patch 只带平铺字段(统一输入框关键词 / 侧栏勾选 / 表达式 / 有无标签的降级通道)时
 *   并入第 0 组(在线口径;旧 JSON 回读的「前插新组」在 parse 的 `normalizeGroups` 里);
 * - patch 带 `sorts` 时以 `sorts` 为权威并**落态即同步**旧 `sort` 镜像。
 */
export function applyFilterPatch(
  cur: FilterConditions,
  value: Partial<FilterConditions>
): FilterConditions {
  const next = { ...cur, ...value };
  if (value.sorts !== undefined) {
    next.sort = sortMirror(value.sorts);
    return normalizeGroups(next);
  }
  if (value.sort !== undefined) {
    next.sorts = sortsFromLegacy(value.sort === 'oldest' ? 'oldest' : 'newest');
  }
  const hasFlat = FLAT_FIELDS.some((k) => value[k] !== undefined);
  if (value.groups === undefined && hasFlat) return applyFlatPatch(next, value);
  return normalizeGroups(next);
}

/**
 * 标签选中开关(侧栏点标签 / 统一输入框同一口径):
 * 未选中则加入第 0 组(默认"含子级"),已选中则移除;排除侧已有该路径时**移到包含侧** ——
 * 与 `tag-tree.ts::toggleTagPick` 同语义;遗留数据两侧同路径时按旧口径只清排除侧、保留包含侧原值。
 */
export function toggleFilterTag(c: FilterConditions, path: string): FilterConditions {
  const n = normalizeGroups(c);
  const has = (kind: GroupItem['kind']): boolean =>
    n.groups.some((g) => g.items.some((it) => it.kind === kind && 'path' in it && it.path === path));
  const inTags = has('tag');
  const inExclude = has('excludeTag');
  if (inTags && inExclude) return removePathItems(n, 'excludeTag', path);
  if (inTags) return removePathItems(n, 'tag', path);
  if (inExclude) {
    return addGroupItem(removePathItems(n, 'excludeTag', path), {
      kind: 'tag',
      path,
      includeChildren: true,
    });
  }
  return applyTagPick(n, path, { exclude: false, includeChildren: true });
}

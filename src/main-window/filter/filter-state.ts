/**
 * 单份筛选条件的持久化(spec 2026-09-25 §2):settings 键 `filter_current`。
 * 键名真源在 Rust `db/repos/settings.rs` 的 `FILTER_CURRENT_KEY`,这里是它的镜像常量
 * (与其它 settings 键同一约定:真源在 Rust,前端只是同名字符串)。
 * 落库形状就是一个 `FilterConditions` 对象的 JSON,与 Rust `notes_filter.rs` 的
 * Serialize 同构(八个 camelCase 字段)。
 * 本文件只有纯函数(便于单测);读写 settings 的副作用在 use-filter-state.ts。
 */
import { EMPTY_FILTER, sortMirror, sortsFromLegacy } from '../../shared/filter-conditions';
import type { FilterConditions, SortCond } from '../../shared/filter-conditions';
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
 * **返回副本**:parseFilterJson 在退化路径上会直接返回模块级的 `EMPTY_FILTER` 常量本身,
 * 而本函数的产物会长期存在状态里(持有共享对象 = 潜在的别名改写风险,见评审 M3)。
 */
export function parseFilterState(raw: string | null): FilterConditions {
  return { ...parseFilterJson(raw) };
}

/** 排序列序列化:友类型联合原样落库(kind/dir/enabled,标签轴额外带 path) */
const serializeSort = (s: SortCond) =>
  s.kind === 'tag' ? { kind: s.kind, path: s.path, dir: s.dir, enabled: s.enabled } : { ...s };

/** 序列化为落库文本:只写约定的九个字段,未知字段一律不落地(前向兼容) */
export function serializeFilterState(c: FilterConditions): string {
  return JSON.stringify({
    keyword: c.keyword,
    tags: c.tags.map((t) => ({ path: t.path, includeChildren: t.includeChildren })),
    excludeTags: c.excludeTags.map((t) => ({ path: t.path, includeChildren: t.includeChildren })),
    relations: c.relations.map((r) => ({ path: r.path })),
    excludeRelations: c.excludeRelations.map((r) => ({ path: r.path })),
    tagPresence: c.tagPresence,
    sort: sortMirror(c.sorts),
    sorts: c.sorts.map(serializeSort),
    expr: c.expr,
  });
}

/**
 * 落态兼容(设计 §4.2/§4.7):
 * - patch 带 `sorts` 时以 `sorts` 为权威,并**落态即同步**旧 `sort` 镜像
 *   (读口仍按 `conditions.sort` 取命令勾选态与文案;镜像本身不参与 `filterKey`)。
 * - patch 只带旧 `sort`(旧构建/旧调用点降级通道)时折算成一条时间排序,不碰 `sort` 本身。
 */
export function applyFilterPatch(
  cur: FilterConditions,
  value: Partial<FilterConditions>
): FilterConditions {
  const next = { ...cur, ...value };
  if (value.sorts !== undefined) {
    next.sort = sortMirror(value.sorts);
    return next;
  }
  if (value.sort !== undefined) {
    next.sorts = sortsFromLegacy(value.sort === 'oldest' ? 'oldest' : 'newest');
  }
  return next;
}

/**
 * 标签选中开关:未选中则加入(默认"含子级"),已选中则移除;
 * 排除侧已有该路径时**移到包含侧** —— 与侧栏 toggleTagPick、统一输入框 `#` 同一口径
 * (沿用了标签页时代 toggleActiveTag 的语义,只少了"当前页"那层状态机外壳)。
 */
export function toggleFilterTag(c: FilterConditions, path: string): FilterConditions {
  if (c.excludeTags.some((t) => t.path === path)) {
    // 走 applyTagPick 而不是裸 spread:与侧栏/统一输入框共用去重(遗留数据里万一两侧同路径,
    // 结果也不会出现重复的 tags 项)
    const moved = applyTagPick(
      { ...c, excludeTags: c.excludeTags.filter((t) => t.path !== path) },
      path,
      { exclude: false, includeChildren: true }
    );
    return { ...c, tags: moved.tags, excludeTags: moved.excludeTags };
  }
  const tags = c.tags.some((t) => t.path === path)
    ? c.tags.filter((t) => t.path !== path)
    : applyTagPick(c, path, { exclude: false, includeChildren: true }).tags;
  return { ...c, tags };
}

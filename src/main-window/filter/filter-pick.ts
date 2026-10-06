/**
 * 标签 / 关系选择落笔的纯函数(自 filter-chips.ts 抽出,守 200 行上限)。
 * 同一路径已存在(不论含子级开关)则原样返回,不重复添加;排除与引入是两套独立数组。
 */
import type { FilterConditions } from '../../shared/filter-conditions';

/** 关系选择落笔:exclude=false 进 relations、true 进 excludeRelations;同一路径已存在则原样返回 */
export function applyRelationPick(c: FilterConditions, path: string, exclude: boolean): FilterConditions {
  if (exclude) {
    if (c.excludeRelations.some((r) => r.path === path)) return c;
    return { ...c, excludeRelations: [...c.excludeRelations, { path }] };
  }
  if (c.relations.some((r) => r.path === path)) return c;
  return { ...c, relations: [...c.relations, { path }] };
}

/** 标签选择落笔:exclude=false 进 tags、true 进 excludeTags;同一路径已存在则原样返回 */
export function applyTagPick(
  c: FilterConditions,
  path: string,
  opts: { exclude: boolean; includeChildren: boolean }
): FilterConditions {
  if (opts.exclude) {
    if (c.excludeTags.some((t) => t.path === path)) return c;
    return { ...c, excludeTags: [...c.excludeTags, { path, includeChildren: opts.includeChildren }] };
  }
  if (c.tags.some((t) => t.path === path)) return c;
  return { ...c, tags: [...c.tags, { path, includeChildren: opts.includeChildren }] };
}

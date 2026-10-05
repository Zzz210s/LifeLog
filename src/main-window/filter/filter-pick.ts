/**
 * 标签 / 类型选择落笔的纯函数(自 filter-chips.ts 抽出,守 200 行上限)。
 * 同一路径已存在(不论含子级开关)则原样返回,不重复添加;排除与引入是两套独立数组。
 */
import type { FilterConditions } from '../../shared/filter-conditions';

/** 类型选择落笔:exclude=false 进 types、true 进 excludeTypes;同一路径已存在则原样返回 */
export function applyTypePick(c: FilterConditions, path: string, exclude: boolean): FilterConditions {
  if (exclude) {
    if (c.excludeTypes.some((r) => r.path === path)) return c;
    return { ...c, excludeTypes: [...c.excludeTypes, { path }] };
  }
  if (c.types.some((r) => r.path === path)) return c;
  return { ...c, types: [...c.types, { path }] };
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

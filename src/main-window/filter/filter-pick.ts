/**
 * 标签 / 关系选择落笔的纯函数(自 filter-chips.ts 抽出,守 200 行上限)。
 * 条件组化(设计 2026-10-06 §5.5):落笔进**指定组**(默认第 0 组;越界 -> 新建一组),
 * 组内同路径已存在则原样返回(不重复添加);排除与引入是两套独立 kind。
 */
import { addGroupItem } from '../../shared/filter-conditions';
import type { FilterConditions, GroupItem } from '../../shared/filter-conditions';

/** 关系选择落笔:exclude=false 进 relation、true 进 excludeRelation;同组内同路径已存在则原样返回 */
export function applyRelationPick(
  c: FilterConditions,
  path: string,
  exclude: boolean,
  group = 0
): FilterConditions {
  const item: GroupItem = exclude ? { kind: 'excludeRelation', path } : { kind: 'relation', path };
  return addGroupItem(c, item, group);
}

/** 标签选择落笔:exclude=false 进 tag、true 进 excludeTag;同组内同路径已存在则原样返回 */
export function applyTagPick(
  c: FilterConditions,
  path: string,
  opts: { exclude: boolean; includeChildren: boolean; group?: number }
): FilterConditions {
  const item: GroupItem = opts.exclude
    ? { kind: 'excludeTag', path, includeChildren: opts.includeChildren }
    : { kind: 'tag', path, includeChildren: opts.includeChildren };
  return addGroupItem(c, item, opts.group ?? 0);
}

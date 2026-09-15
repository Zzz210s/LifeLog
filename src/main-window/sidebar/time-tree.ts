/**
 * 侧栏「时间」分区纯函数(spec 4.5):从扁平行(list_tags)里挑出时间子树,
 * 复用标签树构建得到 年 -> 月 -> 日 层级(self/subtree 计数沿用)。
 * 过滤在构建树之前完成,故计数导轨与空态都自然正确。
 */
import type { TagCount } from '../../shared/types';
import { isTimeTagPath } from '../../shared/time-tag';
import { buildTree } from './tag-tree';
import type { TagNode } from './tag-tree';

/** 时间子树的行(`时间排序` 根与其后代);无时间标签时返回空数组 */
export function timeRows(rows: TagCount[]): TagCount[] {
  return rows.filter((r) => isTimeTagPath(r.path));
}

/** 扁平 listTags -> 时间层级树(根 `时间排序`,其下 年 -> 月 -> 日);无时间标签返回空数组 */
export function buildTimeTree(rows: TagCount[]): TagNode[] {
  return buildTree(timeRows(rows));
}

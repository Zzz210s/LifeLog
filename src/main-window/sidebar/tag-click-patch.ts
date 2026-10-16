/**
 * 侧栏行的四个条件补丁(设计 2026-10-16 §3/§5.6,计划 T1):
 * Ctrl/⌘ = AND 追加、Alt = 排除切换、Shift = 只看这条,外加右键菜单的「仅本级 / 含子级」。
 * 都返回**完整** `FilterConditions`(调用侧经既有 `onPatch` 的 `groups` 整段替换通道落库),
 * 组结构一律走 shared 的既有出口(`addGroupItem` / `removePathItems` / `allItems`),
 * 不在这里手搓组 —— 唯一的"没有组就新建一组"由 `addGroupItem` 的越界分支承担。
 */
import {
  addGroupItem,
  allItems,
  normalizeGroups,
  removePathItems,
} from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';

/**
 * Ctrl/⌘ + 单击:把该实体加成"与既有条件同时满足"的一项(设计 §3.1)。
 * **幂等**:包含侧任一组的任一项已是该 path -> 原样返回(调用侧据此给一句 flash);
 * 与排除侧互斥(先撤排除项,同 `toggleFilterTag` 的镜像口径)。
 * 落点 = **首个** `op='and'` 的组;没有 and 组时追加一个新的 and 组。
 * **组间 op 是用户的显式结构,这里不动**(组间为 'or' 时新组与既有组是"或",那是用户自己的结构)。
 */
export function andAddTag(c: FilterConditions, path: string): FilterConditions {
  const n = normalizeGroups(c);
  // 早退按"全组"判而非"目标组":同一 path 住非首个 and 组时,漏判会在别处复制出第二份
  const dup = n.groups.some((g) => g.items.some((it) => it.kind === 'tag' && it.path === path));
  if (dup) return n;
  const base = removePathItems(n, 'excludeTag', path);
  const gi = base.groups.findIndex((g) => g.op === 'and');
  // gi < 0 时传入越界下标:addGroupItem 追加一个 op='and' 的组(量纲同上,不手搓组结构)
  return addGroupItem(
    base,
    { kind: 'tag', path, includeChildren: true },
    gi >= 0 ? gi : base.groups.length
  );
}

/**
 * Alt + 单击:排除侧**切换**(设计 §3.2)。已在排除侧 -> 移出(Alt 再点 = 撤销);
 * 否则 = 从包含侧迁移过来,沿用该行原有的"仅本级 / 含子级"口径(没有包含项则默认含子级),
 * 排除项恒落第 0 组(与 `toggleFilterTag` 的加入口径一致)。
 */
export function toggleExcludeTag(c: FilterConditions, path: string): FilterConditions {
  const n = normalizeGroups(c);
  const excluded = n.groups.some((g) =>
    g.items.some((it) => it.kind === 'excludeTag' && it.path === path)
  );
  if (excluded) return removePathItems(n, 'excludeTag', path);
  const prev = allItems(n).find((it) => it.kind === 'tag' && it.path === path);
  const includeChildren = prev !== undefined && prev.kind === 'tag' ? prev.includeChildren : true;
  return addGroupItem(
    removePathItems(n, 'tag', path),
    { kind: 'excludeTag', path, includeChildren },
    0
  );
}

/**
 * Shift + 单击:只看这条(设计 §3.3)。**只清标签条件** —— 全部 `tag` / `excludeTag` 删掉,
 * 关系 / 排除关系 / 关键词 / 表达式 / 有无标签 / 树内外 / 单行 / 排序 / 分组一律保留;
 * 组头保留(与"组变空也保留"口径一致)。沿用原有同 path 的 tag 项的"仅本级 / 含子级"口径,
 * 把该项放进第 0 组;没有任何组时由 `addGroupItem` 的越界分支新建第 0 组。
 */
export function onlyThisTag(c: FilterConditions, path: string): FilterConditions {
  const n = normalizeGroups(c);
  const prev = allItems(n).find((it) => it.kind === 'tag' && it.path === path);
  const includeChildren = prev !== undefined && prev.kind === 'tag' ? prev.includeChildren : true;
  const stripped: FilterConditions = {
    ...n,
    groups: n.groups.map((g) => ({
      ...g,
      items: g.items.filter((it) => it.kind !== 'tag' && it.kind !== 'excludeTag'),
    })),
  };
  return addGroupItem(stripped, { kind: 'tag', path, includeChildren }, 0);
}

/**
 * 右键「仅看本级 / 含子级」(设计 §5.6):包含侧已有该 path -> **遍历所有组**就地改写它的
 * `includeChildren`(不新增副本,否则同一路径会同时存在"仅本级"与"含子级"两份);
 * 不在包含侧 -> 按目标口径加入第 0 组(两项都不做禁用态)。
 */
export function setTagScope(
  c: FilterConditions,
  path: string,
  includeChildren: boolean
): FilterConditions {
  const n = normalizeGroups(c);
  const included = allItems(n).some((it) => it.kind === 'tag' && it.path === path);
  if (!included) return addGroupItem(n, { kind: 'tag', path, includeChildren }, 0);
  const next: FilterConditions = {
    ...n,
    groups: n.groups.map((g) => ({
      ...g,
      items: g.items.map((it) =>
        it.kind === 'tag' && it.path === path ? { kind: 'tag', path, includeChildren } : it
      ),
    })),
  };
  return next;
}

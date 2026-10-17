/**
 * 条件批量的**四个补丁**(方案 A,spec 2026-10-17 §A2):自 `cond-batch.ts` 拆出守 200 行上限 ——
 * 那里放键 / 选中集 / 闸门,这里放「怎么改 conditions」。四个函数都返回完整 `FilterConditions`,
 * 调用侧经 `onPatch({ groups, groupOp })` 整段替换落库(既有通道,不新增 IPC)。
 *
 * 位置即身份:`sel` 是条件项的位置键(`0:2`)。挪位 / 删项后选中集怎么跟,由
 * `cond-batch::reselectKeys` 在补丁之后重认 —— 只有删除清选中。
 * `Axis` 口径:空组在纯函数里保留组头(界面仍可往里加条件),落库时由 `normalizeGroups` 丢弃。
 */
import { migrateFlat } from '../../shared/filter-conditions';
import type { FilterConditions, GroupItem } from '../../shared/filter-conditions';
import { condKey, isTagItem } from './cond-batch';
import type { CondKey } from './cond-batch';

/** 删除选中项;空组保留组头(落库时丢) —— 与既有单条 × 删除(removePathItems)同一口径 */
export function deleteSelected(c: FilterConditions, sel: ReadonlySet<CondKey>): FilterConditions {
  const m = migrateFlat(c);
  return {
    ...m,
    groups: m.groups.map((g, gi) => ({
      ...g,
      items: g.items.filter((_, ii) => !sel.has(condKey(gi, ii))),
    })),
  };
}

/** 含子级 ⇄ 仅本级:就地改写选中标签项(位置不动,所以选中集可以原样跟过这一笔) */
export function setChildrenSelected(
  c: FilterConditions,
  sel: ReadonlySet<CondKey>,
  includeChildren: boolean
): FilterConditions {
  const m = migrateFlat(c);
  return {
    ...m,
    groups: m.groups.map((g, gi) => ({
      ...g,
      items: g.items.map((it, ii) =>
        sel.has(condKey(gi, ii)) && isTagItem(it) ? { ...it, includeChildren } : it
      ),
    })),
  };
}

/** 移到排除侧 / 移回包含侧:恒落第 0 组(与 `toggleFilterTag` 的「排除侧 -> 包含侧」口径一致);
 *  第 0 组已有同路径同侧项时去重(含本次一起搬过来的重复),原位置取走。 */
export function moveSideSelected(
  c: FilterConditions,
  sel: ReadonlySet<CondKey>,
  side: 'exclude' | 'include'
): FilterConditions {
  const m = migrateFlat(c);
  const targetKind: 'tag' | 'excludeTag' = side === 'exclude' ? 'excludeTag' : 'tag';
  const picked: GroupItem[] = [];
  const kept = m.groups.map((g, gi) => ({
    ...g,
    items: g.items.filter((it, ii) => {
      if (!sel.has(condKey(gi, ii)) || !isTagItem(it)) return true;
      picked.push({
        kind: targetKind,
        path: (it as { path: string }).path,
        includeChildren: (it as { includeChildren: boolean }).includeChildren,
      });
      return false;
    }),
  }));
  if (picked.length === 0) return m;
  if (kept.length === 0) return { ...m, groups: [{ op: 'and', items: picked }] };
  const hasPath = (list: GroupItem[], path: string): boolean =>
    list.some((x) => x.kind === targetKind && 'path' in x && x.path === path);
  const items0 = [...kept[0].items];
  for (const it of picked) {
    const path = (it as { path: string }).path;
    if (!hasPath(items0, path)) items0.push(it);
  }
  return { ...m, groups: [{ op: kept[0].op, items: items0 }, ...kept.slice(1)] };
}

/** 移入新组:选中项从原位置取出,包进一个**新的 `and` 组**追加到末尾;组间 op 不动。 */
export function wrapSelected(c: FilterConditions, sel: ReadonlySet<CondKey>): FilterConditions {
  const m = migrateFlat(c);
  const moved: GroupItem[] = [];
  const kept = m.groups.map((g, gi) => ({
    ...g,
    items: g.items.filter((it, ii) => {
      if (!sel.has(condKey(gi, ii))) return true;
      moved.push(it);
      return false;
    }),
  }));
  if (moved.length === 0) return m;
  return { ...m, groups: [...kept, { op: 'and', items: moved }] };
}

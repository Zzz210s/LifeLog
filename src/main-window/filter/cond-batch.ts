/**
 * 条件条目批量编辑的纯逻辑(方案 A,spec 2026-10-17 §A):条件栏里的多项条件一次改,
 * 而不是逐项点 × 再重加。四个动作都只产出一份「整段替换的 groups」,走 B 那条既有通道
 * (`onPatch({ groups })` -> `applyFilterPatch`),不新增 IPC、不新增后端命令。
 *
 * 条目身份 = `uiGroups` 里的 (组下标, 组内下标) —— 位置即身份,所以选中集不落库;
 * 补丁可能挪位 / 删项,横跨补丁保留选中由 `use-cond-batch` 决定(只有位置不变的动作跟过来)。
 * 非标签项(关键词 / 表达式 / 有无标签 / 树内外 / 单行 / 关系)可以选中,但四个动作整体禁用
 * (`condGate().canRun` 为假),并由浮条给一句中文说明 —— 不静默跳过。
 * 四个补丁函数在 `cond-batch-actions.ts`(本件只放键 / 选中集 / 闸门 / 重认,守 200 行上限)。
 */
import { uiGroups } from '../../shared/filter-conditions';
import type { FilterConditions, GroupItem } from '../../shared/filter-conditions';

/** 条件项的选中键:`${组下标}:${组内下标}` */
export type CondKey = string;

export const condKey = (gi: number, ii: number): CondKey => `${gi}:${ii}`;

/** 当前条件下全部条件项的位置键(全选 / 全选态判定用) */
export function condKeys(c: FilterConditions): CondKey[] {
  const out: CondKey[] = [];
  uiGroups(c).forEach((g, gi) => g.items.forEach((_, ii) => out.push(condKey(gi, ii))));
  return out;
}

/** 单条切换(返回新集合,不原地改) */
export function toggleCondKey(sel: ReadonlySet<CondKey>, key: CondKey): Set<CondKey> {
  const next = new Set(sel);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** 是否已全选;空条件恒 false(没有东西可全选,按钮不该切到「取消全选」) */
export function allCondSelected(sel: ReadonlySet<CondKey>, keys: readonly CondKey[]): boolean {
  return keys.length > 0 && keys.every((k) => sel.has(k));
}

/** 四个动作只作用于标签类条件(含子级 / 排除侧都是标签项) */
export function isTagItem(it: GroupItem): boolean {
  return it.kind === 'tag' || it.kind === 'excludeTag';
}

export interface SelectedCond {
  gi: number;
  ii: number;
  item: GroupItem;
}

/** 选中键 -> 当前条件下的项(失效键直接忽略,不越界) */
export function selectedOf(c: FilterConditions, sel: ReadonlySet<CondKey>): SelectedCond[] {
  const out: SelectedCond[] = [];
  uiGroups(c).forEach((g, gi) =>
    g.items.forEach((item, ii) => {
      if (sel.has(condKey(gi, ii))) out.push({ gi, ii, item });
    })
  );
  return out;
}

/** 项的身份:有路径的按路径(移动后 kind 会变,路径不变),没有路径的按 kind + 值 */
const itemIdent = (it: GroupItem): string =>
  'path' in it ? `path:${it.path}` : `${it.kind}:${JSON.stringify((it as { value: unknown }).value)}`;

/**
 * 位置会变的动作之后:按身份在新条件里重新认出这些项(先到先得,不重复认领),选中集跟过去。
 * 口径与条目批量(方案 B §P7)同源:**只有删除清选中** —— 移动 / 包组后还能接着做下一个动作
 * (实测「移到排除侧 -> 移入新组」的连招在清选中下会变成静默空操作)。
 */
export function reselectKeys(next: FilterConditions, targets: readonly GroupItem[]): Set<CondKey> {
  const pool: { key: CondKey; id: string }[] = [];
  uiGroups(next).forEach((g, gi) =>
    g.items.forEach((it, ii) => pool.push({ key: condKey(gi, ii), id: itemIdent(it) }))
  );
  const out = new Set<CondKey>();
  for (const t of targets) {
    const hit = pool.find((p) => !out.has(p.key) && p.id === itemIdent(t));
    if (hit !== undefined) out.add(hit.key);
  }
  return out;
}

export interface CondGate {
  /** 选中且仍存在的条件项 */
  items: SelectedCond[];
  /** 四个动作是否可用(至少选中一项,且选中项全是标签条件) */
  canRun: boolean;
  /** 不可用原因(中文);没有需要交代的事时为 null */
  reason: string | null;
  /** 「含子级 ⇄ 仅本级」按钮文案 = 点下去的效果 */
  childrenLabel: string;
  /** 移动目标侧(null = 选中项同时落在两侧,方向二义,只能先统一到一侧) */
  side: 'exclude' | 'include' | null;
  sideLabel: string;
}

const NON_TAG_REASON =
  '选中项里有非标签条件（关键词 / 表达式 / 有无标签 / 树内外 / 单行 / 关系），这四个动作只作用于标签条件';
const MIXED_SIDE_REASON = '选中项同时落在包含侧和排除侧，先只选一侧再移动';

/** 四个动作的可用性与按钮态(纯派生;按钮文案与禁用理由同出一处,防两处各判一次漂移) */
export function condGate(c: FilterConditions, sel: ReadonlySet<CondKey>): CondGate {
  const items = selectedOf(c, sel);
  const tags = items.filter((s) => isTagItem(s.item));
  const canRun = items.length > 0 && tags.length === items.length;
  const hasTag = tags.some((s) => s.item.kind === 'tag');
  const hasExclude = tags.some((s) => s.item.kind === 'excludeTag');
  const side = hasTag && hasExclude ? null : hasExclude ? 'include' : hasTag ? 'exclude' : null;
  let reason: string | null = null;
  if (items.length > 0 && tags.length !== items.length) reason = NON_TAG_REASON;
  else if (side === null && tags.length > 0) reason = MIXED_SIDE_REASON;
  const allChildren =
    tags.length > 0 &&
    tags.every((s) => (s.item as { includeChildren: boolean }).includeChildren === true);
  return {
    items,
    canRun,
    reason,
    childrenLabel: allChildren ? '仅本级' : '含子级',
    side,
    sideLabel: side === 'include' ? '移回包含侧' : '移到排除侧',
  };
}

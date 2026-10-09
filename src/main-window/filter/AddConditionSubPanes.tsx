/**
 * 「添加条件」下拉的三个**子面板**(自 `AddConditionMenu.tsx` 拆出,守 200 行上限):
 * 有无标签 / 树内·单行 / 条件落进哪一组。纯展示 + 回调,状态(当前 pane 与目标组)在菜单里。
 * 三块都渲染在菜单容器的 `[role="menu"]` 下(片段返回,不额外包一层),菜单项顺序与旧实现逐字一致。
 */
import type { ReactNode } from 'react';
import { addGroupItem, migrateFlat } from '../../shared/filter-conditions';
import type { FilterConditions, FilterGroup, GroupItem } from '../../shared/filter-conditions';

/** 菜单项的统一样式(菜单与子面板共用) */
export const ITEM_CLASS =
  'block w-full rounded-xs px-2.5 py-1.5 text-left text-ui text-muted hover:bg-accent-soft hover:text-accent-text';

export interface SubPaneProps {
  conditions: FilterConditions;
  /** 局部更新(子面板里已算好整个条件对象) */
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 落笔到第几组 */
  group: number;
  /** 选择完成:关菜单并回到主面板 */
  onDone: () => void;
}

/** 有无标签在组内唯一:先清掉所有 presence 项再落新的 */
function clearPresence(c: FilterConditions): FilterConditions {
  const m = migrateFlat(c);
  return {
    ...m,
    groups: m.groups.map((g) => ({
      ...g,
      items: g.items.filter((it) => it.kind !== 'presence'),
    })),
  };
}

/** 有无标签:不限 / 有标签 / 无标签 */
export function PresencePane(p: SubPaneProps): ReactNode {
  return (
    <>
      {([
        [null, '不限'],
        ['any', '有标签'],
        ['none', '无标签'],
      ] as const).map(([v, label]) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          className={ITEM_CLASS}
          onClick={() => {
            p.onPatch(
              v === null
                ? clearPresence(p.conditions)
                : addGroupItem(clearPresence(p.conditions), { kind: 'presence', value: v }, p.group)
            );
            p.onDone();
          }}
        >
          {label}
        </button>
      ))}
    </>
  );
}

/** 在树内 / 不在树内 + `meta` 单行 / 多行(spec §4.1 两新条件种类) */
export function MembershipPane(p: SubPaneProps): ReactNode {
  return (
    <>
      {([
        ['treeMembership', 'out', '不在树内'],
        ['treeMembership', 'in', '在树内'],
        ['singleLine', 'multi', '多行'],
        ['singleLine', 'single', '单行'],
      ] as const).map(([k, v, label]) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          className={ITEM_CLASS}
          onClick={() => {
            p.onPatch(addGroupItem(p.conditions, { kind: k, value: v } as GroupItem, p.group));
            p.onDone();
          }}
        >
          {label}
        </button>
      ))}
    </>
  );
}

/** 条件落进哪一组:列出现有组(标出组内且/或与项数)+ 新建一组 */
export function GroupPane(p: SubPaneProps & { groups: FilterGroup[]; onPickGroup: (gi: number) => void }): ReactNode {
  return (
    <>
      <div className="px-2.5 py-1 text-micro text-muted">条件落进哪一组</div>
      {p.groups.map((g, gi) => (
        <button
          key={gi}
          type="button"
          role="menuitem"
          className={ITEM_CLASS + (gi === p.group ? ' bg-accent-soft text-accent-text' : '')}
          onClick={() => p.onPickGroup(gi)}
        >
          {`第 ${gi + 1} 组（组内${g.op === 'and' ? '且' : '或'}，${g.items.length} 项）`}
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS + (p.group >= p.groups.length ? ' bg-accent-soft text-accent-text' : '')}
        onClick={() => p.onPickGroup(p.groups.length)}
      >
        新建一组（下一个条件进新组）
      </button>
    </>
  );
}

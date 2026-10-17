/**
 * 条件条目批量编辑的会话状态(方案 A,spec 2026-10-17 §A):与条目批量(B)同构 ——
 * 不落库、切筛选 / Esc 退出并清选中。四个动作各自只打**一笔**补丁
 * (`onPatch({ groups })` 整段替换),纯补丁函数在 `cond-batch`。
 *
 * 补丁后选中集怎么走(与条目批量 B §P7 同源):**只有删除清选中**(删掉的项已不存在);
 * 「含子级 ⇄ 仅本级」不挪位,选中集原样跟随;移到另一侧 / 移入新组会挪位,按身份
 * (`cond-batch::reselectKeys`,标签项认路径)在新条件里重认 —— 连续动作(仅本级 → 排除 → 新组)
 * 不必重新勾选。
 * 与条目批量的互斥接线在 `use-batch-modes`(两者不能同时开,同时开会让「选中」二义)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_FILTER, filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import {
  allCondSelected,
  condGate,
  condKeys,
  reselectKeys,
  selectedOf,
  toggleCondKey,
} from './cond-batch';
import type { CondGate, CondKey } from './cond-batch';
import {
  deleteSelected,
  moveSideSelected,
  setChildrenSelected,
  wrapSelected,
} from './cond-batch-actions';

export interface CondBatchApi {
  on: boolean;
  selected: ReadonlySet<CondKey>;
  /** 选中且仍存在的条件项数(浮条读数;不用 selected.size,避免失效键把读数报大) */
  count: number;
  /** 当前条件下全部条件项是否已选中 */
  allSelected: boolean;
  /** 四个动作的可用性与按钮态(纯派生) */
  gate: CondGate;
  toggleOn: () => void;
  toggle: (key: CondKey) => void;
  selectAll: () => void;
  cancel: () => void;
  removeSelected: () => void;
  setChildren: (includeChildren: boolean) => void;
  moveSide: () => void;
  wrapNewGroup: () => void;
}

export function useCondBatch(o: {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
}): CondBatchApi {
  const { conditions, onPatch } = o;
  const [on, setOn] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<CondKey>>(() => new Set());
  const key = filterKey(conditions);
  // 本次补丁自己带的选中集(位置不变的动作跟随);null = 不是自己打的补丁 -> 退出并清空
  const carry = useRef<ReadonlySet<CondKey> | null>(null);
  const lastKey = useRef(key);

  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    const kept = carry.current;
    carry.current = null;
    if (kept === null) {
      setOn(false);
      setSelected(new Set());
      return;
    }
    setSelected(kept);
  }, [key]);

  // Esc 退出:优先级与条目批量同档 —— 预览卡片还在 DOM 里说明它先吃这一下
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[data-testid="tag-preview-card"]') !== null) return;
      setOn(false);
      setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);

  const keys = useMemo(() => condKeys(conditions), [conditions]);
  const gate = useMemo(() => condGate(conditions, selected), [conditions, selected]);

  const toggleOn = useCallback(() => {
    setOn((v) => !v);
    setSelected(new Set());
  }, []);
  const cancel = useCallback(() => {
    setOn(false);
    setSelected(new Set());
  }, []);
  const toggle = useCallback((k: CondKey) => setSelected((s) => toggleCondKey(s, k)), []);
  const selectAll = useCallback(() => {
    setSelected((s) => (allCondSelected(s, keys) ? new Set<CondKey>() : new Set(keys)));
  }, [keys]);

  /** 打一笔补丁;keep = 位置不变(选中集原样跟过来)/ 'reflect' = 位置会变(按身份在新条件里重认) */
  const apply = useCallback(
    (keep: boolean | 'reflect', fn: (c: FilterConditions, sel: ReadonlySet<CondKey>) => FilterConditions) => {
      const targets = selectedOf(conditions, selected).map((s) => s.item);
      const next = fn(conditions, selected);
      const carried: ReadonlySet<CondKey> =
        keep === true ? selected : keep === 'reflect' ? reselectKeys(next, targets) : new Set<CondKey>();
      carry.current = carried;
      setSelected(carried);
      onPatch({ groups: next.groups, groupOp: next.groupOp });
    },
    [conditions, onPatch, selected]
  );

  const removeSelected = useCallback(() => apply(false, deleteSelected), [apply]);
  const setChildren = useCallback(
    (includeChildren: boolean) =>
      apply(true, (c, sel) => setChildrenSelected(c, sel, includeChildren)),
    [apply]
  );
  const moveSide = useCallback(() => {
    const side = gate.side;
    if (side === null) return;
    apply('reflect', (c, sel) => moveSideSelected(c, sel, side));
  }, [apply, gate.side]);
  const wrapNewGroup = useCallback(() => apply('reflect', wrapSelected), [apply]);

  return {
    on,
    selected,
    count: gate.items.length,
    allSelected: allCondSelected(selected, keys),
    gate,
    toggleOn,
    toggle,
    selectAll,
    cancel,
    removeSelected,
    setChildren,
    moveSide,
    wrapNewGroup,
  };
}

/** 批量态缺席时的占位(测试夹具与只读用法不必自己造一份完整 CondBatchApi) */
export const OFF_COND_BATCH: CondBatchApi = {
  on: false,
  selected: new Set<CondKey>(),
  count: 0,
  allSelected: false,
  gate: condGate(EMPTY_FILTER, new Set()),
  toggleOn: () => {},
  toggle: () => {},
  selectAll: () => {},
  cancel: () => {},
  removeSelected: () => {},
  setChildren: () => {},
  moveSide: () => {},
  wrapNewGroup: () => {},
};

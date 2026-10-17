/**
 * 条件栏两个批量态的互斥接线(spec 2026-10-17 §A1):同一时刻最多一个 `on` —— 同时开会让
 * 「选中」二义(勾的是条目还是条件?),也让浮动条并排两条。口径:**后开的一方关掉另一方**。
 * 两处开关与两条浮条都从这里取,互斥只在这一处实现(避免 App / StreamView 各判一次漂移)。
 *
 * App 只用这一份;`use-batch-modes.dom.test.ts` 也是如此,所以用例钉住的就是真实接线。
 */
import { useCallback } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import { useBatchSelection } from './use-batch-selection';
import type { BatchApi } from './use-batch-selection';
import { useCondBatch } from './use-cond-batch';
import type { CondBatchApi } from './use-cond-batch';

export interface BatchModes {
  /** 条目批量(B:加/去标签、删除、导出) */
  notes: BatchApi;
  /** 条件批量(A:改条件栏里的多项条件) */
  conds: CondBatchApi;
}

export function useBatchModes(o: {
  conditions: FilterConditions;
  notes: Note[];
  refresh: () => unknown;
  onPatch: (value: Partial<FilterConditions>) => void;
}): BatchModes {
  const notes = useBatchSelection({ conditions: o.conditions, notes: o.notes, refresh: o.refresh });
  const conds = useCondBatch({ conditions: o.conditions, onPatch: o.onPatch });
  const { cancel: cancelNotes, toggleOn: toggleNotes } = notes;
  const { cancel: cancelConds, toggleOn: toggleConds } = conds;

  // 打开条目批量:先把条件批量关掉,再切自己(自己本就开着 = 关掉,另一方保持关)
  const openNotes = useCallback(() => {
    cancelConds();
    toggleNotes();
  }, [cancelConds, toggleNotes]);
  const openConds = useCallback(() => {
    cancelNotes();
    toggleConds();
  }, [cancelNotes, toggleConds]);

  return {
    notes: { ...notes, toggleOn: openNotes },
    conds: { ...conds, toggleOn: openConds },
  };
}

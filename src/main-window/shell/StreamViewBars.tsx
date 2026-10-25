/**
 * 信息流顶部三段的挂点(自 StreamView.tsx 抽出以守 200 行红线):条件栏 → 条件批量浮条 → 条目批量浮条。
 * DOM 顺序与抽取前逐字一致(条件栏之后、错误条之前);两态的派生仍在 StreamView(那里还要给 `NoteStream`),
 * 这里只收已定好的档位,不自己读 `batchModes`,免得两处判一次漂移。
 */
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { BatchApi } from '../filter/use-batch-selection';
import type { CondBatchApi } from '../filter/use-cond-batch';
import { ConditionBar } from '../filter/ConditionBar';
import { CondBatchBar } from '../filter/CondBatchBar';
import { BatchBar } from '../filter/BatchBar';

export interface StreamViewBarsProps {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
  addConditionOpen: boolean;
  onAddConditionOpenChange: (open: boolean) => void;
  dataVersion: number;
  /** 条目批量档位(关档时 `on=false`,浮条不渲染) */
  batch: BatchApi;
  /** 条件批量档位(同上) */
  condBatch: CondBatchApi;
}

export function StreamViewBars(p: StreamViewBarsProps): ReactNode {
  return (
    <>
      <ConditionBar
        conditions={p.conditions}
        onPatch={p.onPatch}
        addConditionOpen={p.addConditionOpen}
        onAddConditionOpenChange={p.onAddConditionOpenChange}
        batch={{ on: p.batch.on, toggle: p.batch.toggleOn }}
        condBatch={p.condBatch}
      />
      {/* 条件批量浮条(§A1):与条目批量浮条互斥,同一挂点(条件栏之后、错误条之前) */}
      {p.condBatch.on && <CondBatchBar cond={p.condBatch} />}
      {/* 批量浮条(§7.2 顺序):条件栏之后、错误条之前;不在批量态时不渲染 */}
      {p.batch.on && <BatchBar batch={p.batch} dataVersion={p.dataVersion} />}
    </>
  );
}

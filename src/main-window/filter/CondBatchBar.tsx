/**
 * 条件批量浮条(spec 2026-10-17 §A1):`已选 N 项` · 全选 · 取消 · 四个动作 + 一句禁用说明。
 * 视觉语言复用条目批量浮条(`BatchBar`)的同一套外壳与按钮档位,不另起一套样式;
 * 挂在条件栏之后、条目批量浮条原位之处(两态互斥,不会同时出现)。
 * 四个动作只作用于**标签条件**:选中项里有非标签条件时整体禁用并给出中文原因(`gate.reason`),
 * 不静默跳过。落库是 `onPatch({ groups })` 整段替换,由 `use-cond-batch` 打补丁。
 */
import type { ReactNode } from 'react';
import { BTN_DANGER, BTN_SECONDARY, BTN_TEXT } from '../shell/button-classes';
import type { CondBatchApi } from './use-cond-batch';

export interface CondBatchBarProps {
  cond: CondBatchApi;
}

export function CondBatchBar(p: CondBatchBarProps): ReactNode {
  const { gate, count } = p.cond;
  // 按钮禁用时把原因挂在 title 上(浮条里只展示一条主要说明,避免刷屏)
  const why = gate.reason ?? (count === 0 ? '先选中条件' : undefined);
  return (
    <div
      data-testid="cond-batch-bar"
      className="flex flex-wrap items-center gap-2 border-b border-border bg-hover px-4 py-1"
    >
      <span data-testid="cond-batch-count" className="text-label text-muted">
        已选 {count} 项
      </span>
      <button
        type="button"
        data-testid="cond-batch-select-all"
        className={BTN_SECONDARY}
        onClick={p.cond.selectAll}
      >
        {p.cond.allSelected ? '取消全选' : '全选'}
      </button>
      <button
        type="button"
        data-testid="cond-batch-delete"
        disabled={!gate.canRun}
        title={why}
        className={BTN_DANGER}
        onClick={p.cond.removeSelected}
      >
        删除选中
      </button>
      <button
        type="button"
        data-testid="cond-batch-children"
        disabled={!gate.canRun}
        title={why}
        className={BTN_SECONDARY}
        onClick={() => p.cond.setChildren(gate.childrenLabel === '含子级')}
      >
        {gate.childrenLabel}
      </button>
      <button
        type="button"
        data-testid="cond-batch-move"
        disabled={!gate.canRun || gate.side === null}
        title={why}
        className={BTN_SECONDARY}
        onClick={p.cond.moveSide}
      >
        {gate.sideLabel}
      </button>
      <button
        type="button"
        data-testid="cond-batch-group"
        disabled={!gate.canRun}
        title={why}
        className={BTN_SECONDARY}
        onClick={p.cond.wrapNewGroup}
      >
        移入新组
      </button>
      <button
        type="button"
        data-testid="cond-batch-cancel"
        className={BTN_TEXT + ' text-muted'}
        onClick={p.cond.cancel}
      >
        取消
      </button>
      {gate.reason !== null && (
        <span data-testid="cond-batch-reason" className="text-label text-warn">
          {gate.reason}
        </span>
      )}
    </div>
  );
}

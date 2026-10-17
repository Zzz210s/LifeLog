/**
 * 批量浮条(spec 2026-10-17 §3/§5/§6):`已选 N 条` · 全选本页 · 全选筛选结果 · 取消 ·
 * 加/去标签 · 删除 · 导出选中 · 回执区。挂在条件栏与错误条之间(§7.2 的顺序),
 * 只在批量态渲染;Esc / 切筛选的退出逻辑在 `use-batch-selection`。
 */
import type { ReactNode } from 'react';
import { BATCH_DELETE_WARN, selectAllLabel, selectPageLabel } from './batch-mode';
import { BatchTagInput } from './BatchTagInput';
import type { BatchApi } from './use-batch-selection';
import { useBatchExport } from './use-batch-export';
import { BTN_DANGER, BTN_SECONDARY, BTN_TEXT } from '../shell/button-classes';

export interface BatchBarProps {
  batch: BatchApi;
  /** 候选池的作废键(标签数据版本) */
  dataVersion: number;
}

export function BatchBar(p: BatchBarProps): ReactNode {
  const ex = useBatchExport();
  const n = p.batch.selected.size;
  const none = n === 0;

  return (
    <div
      data-testid="batch-bar"
      className="flex flex-wrap items-center gap-2 border-b border-border bg-hover px-4 py-1"
    >
      <span data-testid="batch-count" className="text-label text-muted">
        已选 {n} 条
      </span>
      <button
        type="button"
        data-testid="batch-select-page"
        disabled={p.batch.busy}
        className={BTN_SECONDARY}
        onClick={p.batch.selectPage}
      >
        {selectPageLabel(p.batch.pageAll)}
      </button>
      <button
        type="button"
        data-testid="batch-select-all"
        disabled={p.batch.busy}
        className={BTN_SECONDARY}
        onClick={p.batch.selectAll}
      >
        {selectAllLabel(p.batch.filterAll, p.batch.filterTotal)}
      </button>
      <BatchTagInput
        disabled={none || p.batch.busy}
        dataVersion={p.dataVersion}
        add={p.batch.addTag}
        remove={p.batch.removeTag}
      />
      <button
        type="button"
        data-testid="batch-delete"
        disabled={none || p.batch.busy}
        title={none ? '先选中条目' : `删除 ${n} 条（先自动快照）`}
        className={BTN_DANGER}
        onClick={p.batch.removeSelected}
      >
        删除 {n} 条
      </button>
      <button
        type="button"
        data-testid="batch-export"
        disabled={none || ex.exporting}
        title={none ? '先选中条目' : undefined}
        className={BTN_SECONDARY}
        onClick={() => {
          void ex.exportSelected([...p.batch.selected]).then((msg) => {
            if (msg !== null) p.batch.notify(msg);
          });
        }}
      >
        导出选中
      </button>
      <button
        type="button"
        data-testid="batch-cancel"
        className={BTN_TEXT + ' text-muted'}
        onClick={p.batch.cancel}
      >
        取消
      </button>
      {p.batch.notice !== null && (
        <span data-testid="batch-notice" className="text-label text-muted">
          {p.batch.notice}
        </span>
      )}
      {n >= BATCH_DELETE_WARN && (
        <span data-testid="batch-warn" className="text-label text-warn">
          选中超过 {BATCH_DELETE_WARN} 条，删除前请确认已看过快照
        </span>
      )}
    </div>
  );
}

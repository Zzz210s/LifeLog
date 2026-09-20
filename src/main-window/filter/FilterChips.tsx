import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Chip } from './filter-chips';

export interface FilterChipsProps {
  /** 当前条件的全部 chip(由 FilterBar 用 chipsOf 派生) */
  chips: Chip[];
  /** 单删:传回「删掉该 chip 后的完整条件对象」 */
  onRemove: (next: FilterConditions) => void;
  /** 点击「表达式」chip 的标签再次编辑(未传时表达式 chip 不可点) */
  onEditExpr?: () => void;
}

/** chip 底色按种类区分:排除偏红、排序/有无标签偏灰、其余(关键词/标签/表达式)偏蓝 */
function chipClass(kind: Chip['kind']): string {
  if (kind === 'excludeTag') return 'border-danger/40 bg-danger-soft text-danger hover:border-danger';
  if (kind === 'sort' || kind === 'presence')
    return 'border-border bg-panel text-muted hover:border-accent';
  return 'border-accent/40 bg-accent-soft text-accent-text hover:border-accent';
}

/** 统一条件 chips(可单删):空数组时不渲染(空条件时芯片区隐藏,spec 6.2) */
export function FilterChips(p: FilterChipsProps): ReactNode {
  if (p.chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="已生效的筛选条件">
      {p.chips.map((chip) => (
        <span
          key={`${chip.kind}:${chip.label}`}
          title={chip.title}
          className={
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ' +
            chipClass(chip.kind)
          }
        >
          {p.onEditExpr !== undefined && chip.kind === 'expr' ? (
            <button
              type="button"
              onClick={p.onEditExpr}
              aria-label={`编辑条件 ${chip.label}`}
              className="max-w-64 truncate underline decoration-dotted"
            >
              {chip.label}
            </button>
          ) : (
            chip.label
          )}
          <button
            type="button"
            onClick={() => p.onRemove(chip.remove)}
            aria-label={`移除条件 ${chip.label}`}
            title={`移除条件 ${chip.label}`}
            className="rounded-full px-0.5 leading-none opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

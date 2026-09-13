import type { ReactNode } from 'react';
import type { FilterConditions } from '../shared/filter-conditions';
import type { Chip } from './filter-chips';

export interface FilterChipsProps {
  /** 当前条件的全部 chip(由 FilterBar 用 chipsOf 派生) */
  chips: Chip[];
  /** 单删:传回「删掉该 chip 后的完整条件对象」 */
  onRemove: (next: FilterConditions) => void;
}

/** chip 底色按种类区分:排除偏红、排序/有无标签偏灰、其余(关键词/标签/日期)偏蓝 */
function chipClass(kind: Chip['kind']): string {
  if (kind === 'excludeTag') return 'border-red-200 bg-red-50 text-red-600 hover:border-red-400';
  if (kind === 'sort' || kind === 'presence')
    return 'border-gray-300 bg-gray-50 text-gray-600 hover:border-blue-400';
  return 'border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-400';
}

/** 统一条件 chips(可单删):空数组时不渲染(空条件时芯片区隐藏,spec 6.2) */
export function FilterChips(p: FilterChipsProps): ReactNode {
  if (p.chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="已生效的筛选条件">
      {p.chips.map((chip) => (
        <span
          key={`${chip.kind}:${chip.label}`}
          className={
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ' +
            chipClass(chip.kind)
          }
        >
          {chip.label}
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

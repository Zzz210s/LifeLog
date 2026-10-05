// 「类型建议」面板的工具条(自 TypeSuggestionsSection 抽出,守 200 行上限):
// 按建议类型筛选 + 全选 / 全不选 / 批量确认。纯展示,状态与写库完全在父组件。
import type { ReactNode } from 'react';
import { BTN_SECONDARY } from '../shell/button-classes';
import { SelectInput } from './controls';

export interface TypeSuggestionsToolbarProps {
  filterType: string;
  filterOptions: { value: string; label: string }[];
  onFilterType: (v: string) => void;
  /** 当前勾选数(批量确认按钮的括注) */
  selectedCount: number;
  busy: boolean;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onConfirm: () => void;
}

export function TypeSuggestionsToolbar(p: TypeSuggestionsToolbarProps): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border py-3">
      <SelectInput
        value={p.filterType}
        label="按建议类型筛选"
        options={p.filterOptions}
        onChange={p.onFilterType}
      />
      <button type="button" aria-label="全选可见" className={BTN_SECONDARY} onClick={p.onSelectAll}>
        全选可见
      </button>
      <button type="button" aria-label="全不选可见" className={BTN_SECONDARY} onClick={p.onSelectNone}>
        全不选可见
      </button>
      <button
        type="button"
        aria-label="批量确认"
        className={BTN_SECONDARY}
        disabled={p.busy}
        onClick={p.onConfirm}
      >
        {`批量确认(${p.selectedCount})`}
      </button>
    </div>
  );
}

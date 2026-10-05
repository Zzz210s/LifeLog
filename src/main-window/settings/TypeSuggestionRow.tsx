// 「类型建议」面板的一行(纯展示 + 回调):勾选、把建议类型改成别的已登记类型、忽略。
// 从 TypeSuggestionsSection 拆出,让面板本体留在 200 行内;状态全由调用方持有。
import type { ReactNode } from 'react';
import type { TypeRef } from '../../shared/types';
import { BTN_TEXT } from '../shell/button-classes';
import { SelectInput } from './controls';
import { type TypeSuggestion } from './type-suggestions';

export interface TypeSuggestionRowProps {
  row: TypeSuggestion;
  /** 已登记类型(供「改成别的类型」下拉) */
  types: readonly TypeRef[];
  checked: boolean;
  /** 当前生效的类型标签 id(可能是改过的) */
  typeId: number;
  onToggle: () => void;
  onType: (typeId: number) => void;
  onIgnore: () => void;
}

export function TypeSuggestionRow({
  row,
  types,
  checked,
  typeId,
  onToggle,
  onType,
  onIgnore,
}: TypeSuggestionRowProps): ReactNode {
  const options = [{ value: String(row.typeTagId), label: row.typeName }];
  for (const r of types) if (r.tagId !== row.typeTagId) options.push({ value: String(r.tagId), label: r.name });

  return (
    <div
      data-type-row={row.tagPath}
      className="flex flex-wrap items-center gap-3 border-b border-border py-2 last:border-b-0"
    >
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <input type="checkbox" checked={checked} aria-label={'选中 ' + row.tagPath} onChange={onToggle} />
        <span className="truncate text-ui text-text" title={row.tagPath}>
          {row.tagPath}
        </span>
      </label>
      <SelectInput
        value={String(typeId)}
        label={'类型 ' + row.tagPath}
        options={options}
        onChange={(v) => onType(Number(v))}
      />
      <span className="text-label text-muted">{row.basis}</span>
      <button type="button" aria-label={'忽略 ' + row.tagPath} className={BTN_TEXT} onClick={onIgnore}>
        忽略
      </button>
    </div>
  );
}

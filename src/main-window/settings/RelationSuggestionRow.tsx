// 「关系建议」面板的一行(纯展示 + 回调):勾选、把建议目标改成别的标签、忽略。
// 从 RelationSuggestionsSection 拆出,让面板本体留在 200 行内;状态全由调用方持有。
import type { ReactNode } from 'react';
import type { TagCount } from '../../shared/types';
import { BTN_TEXT } from '../shell/button-classes';
import { SelectInput } from './controls';
import { leaf, type RelationSuggestion } from './relation-suggestions';

export interface RelationSuggestionRowProps {
  row: RelationSuggestion;
  /** 全部标签(供「改成别的目标」下拉) */
  targets: readonly TagCount[];
  checked: boolean;
  /** 当前生效的目标标签 id(可能是改过的) */
  toId: number;
  onToggle: () => void;
  onTarget: (toId: number) => void;
  onIgnore: () => void;
}

export function RelationSuggestionRow({
  row,
  targets,
  checked,
  toId,
  onToggle,
  onTarget,
  onIgnore,
}: RelationSuggestionRowProps): ReactNode {
  const options: { value: string; label: string }[] = [];
  if (!targets.some((t) => t.id === row.toTagId)) {
    options.push({ value: String(row.toTagId), label: row.toName });
  }
  for (const t of targets) options.push({ value: String(t.id), label: leaf(t.path) });

  return (
    <div
      data-relation-row={row.tagPath}
      className="flex flex-wrap items-center gap-3 border-b border-border py-2 last:border-b-0"
    >
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <input type="checkbox" checked={checked} aria-label={'选中 ' + row.tagPath} onChange={onToggle} />
        <span className="truncate text-ui text-text" title={row.tagPath}>
          {row.tagPath}
        </span>
      </label>
      <SelectInput
        value={String(toId)}
        label={'关系 ' + row.tagPath}
        options={options}
        onChange={(v) => onTarget(Number(v))}
      />
      <span className="text-label text-muted">{row.basis}</span>
      <button type="button" aria-label={'忽略 ' + row.tagPath} className={BTN_TEXT} onClick={onIgnore}>
        忽略
      </button>
    </div>
  );
}

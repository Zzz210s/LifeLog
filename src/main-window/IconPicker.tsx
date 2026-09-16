/**
 * 图标网格选择器(spec 4):`role="radiogroup"` + 每项 `role="radio"`,`title`/`aria-label` 为图标名,
 * 选中项高亮边框;末尾一项「无图标」= null(再点当前项即清空,语义见 view-icons.tsx::nextIconValue)。
 * 白名单顺序即网格顺序。
 */
import type { ReactNode } from 'react';
import { VIEW_ICON_NAMES, ViewIcon, nextIconValue } from './view-icons';

export interface IconPickerProps {
  /** 当前图标名(null = 无图标) */
  value: string | null;
  onChange: (v: string | null) => void;
}

const ITEM = 'flex h-7 items-center justify-center rounded border transition-colors ';
const ICON_ITEM = ITEM + 'w-7 ';
const NONE_ITEM = ITEM + 'px-1.5 text-xs ';

/** 选中态:高亮边框;未选中:透明边框(悬停才显形,避免网格噪声) */
const state = (selected: boolean): string =>
  selected
    ? 'border-accent bg-accent-soft text-accent-text'
    : 'border-transparent text-muted hover:border-border hover:bg-hover';

export function IconPicker(p: IconPickerProps): ReactNode {
  return (
    <div role="radiogroup" aria-label="图标" className="flex flex-wrap gap-1">
      {VIEW_ICON_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={p.value === name}
          aria-label={name}
          title={name}
          onClick={() => p.onChange(nextIconValue(p.value, name))}
          className={ICON_ITEM + state(p.value === name)}
        >
          <ViewIcon name={name} className="h-4 w-4" />
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={p.value === null}
        aria-label="无图标"
        title="无图标(再点已选中的图标即清空)"
        onClick={() => p.onChange(null)}
        className={NONE_ITEM + state(p.value === null)}
      >
        无图标
      </button>
    </div>
  );
}

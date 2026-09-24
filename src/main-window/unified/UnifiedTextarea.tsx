/**
 * 统一输入框的输入域(自 `UnifiedInput` 抽出以守 200 行红线:aria 接线撑不下)。
 *
 * 它是候选下拉的 combobox:单一 tab stop 在输入域,高亮行由 `aria-activedescendant` 指定
 * (行本身不进 Tab 序列)。下拉收起时 `aria-controls` / `aria-activedescendant` 一并撤掉 ——
 * 下拉是条件渲染的,留着就是悬空引用。
 *
 * 自动增高、保存、键盘路由都留在宿主 `UnifiedInput`,这里只渲染输入域。
 */
import type { KeyboardEventHandler, ReactNode, RefObject } from 'react';

export interface UnifiedTextareaProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  disabled: boolean;
  /** 自动增高上限(px),超过转框内滚动 */
  maxHeight: number;
  placeholder: string;
  /** 下拉是否显示(combobox 的 aria-expanded) */
  dropdownShown: boolean;
  /** 下拉容器 id(aria-controls;仅在显示下拉时有意义) */
  dropdownId: string;
  /** 高亮行 id(aria-activedescendant;无候选行时给 null) */
  activeOptionId: string | null;
  onChange: (raw: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
}

export function UnifiedTextarea(p: UnifiedTextareaProps): ReactNode {
  return (
    <textarea
      ref={p.textareaRef}
      data-testid="unified-input"
      aria-label="统一输入框"
      role="combobox"
      aria-expanded={p.dropdownShown}
      aria-autocomplete="list"
      aria-controls={p.dropdownShown ? p.dropdownId : undefined}
      aria-activedescendant={p.dropdownShown ? (p.activeOptionId ?? undefined) : undefined}
      rows={1}
      value={p.value}
      disabled={p.disabled}
      placeholder={p.placeholder}
      onChange={(e) => p.onChange(e.target.value)}
      onKeyDown={p.onKeyDown}
      style={{ maxHeight: p.maxHeight, overflowY: 'auto' }}
      className="block h-8 min-w-0 flex-1 resize-none rounded-sm border border-border-strong bg-raised px-2.5 py-1.5 text-ui text-text outline-none"
    />
  );
}

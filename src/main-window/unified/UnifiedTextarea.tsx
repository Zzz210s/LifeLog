/**
 * 统一输入框的输入域(自 `UnifiedInput` 抽出以守 200 行红线:aria 接线撑不下)。
 *
 * 它是候选下拉的 combobox:单一 tab stop 在输入域,高亮行由 `aria-activedescendant` 指定
 * (行本身不进 Tab 序列)。下拉收起时 `aria-controls` / `aria-activedescendant` 一并撤掉 ——
 * 下拉是条件渲染的,留着就是悬空引用。
 *
 * 自动增高、保存、键盘路由都留在宿主 `UnifiedInput`,这里只渲染输入域。
 * 空输入时不显示占位文案(Task 4):提示由下方提示行(PrefixHint)承担,
 * 框里不放文案就不必跟提示行的文案两头维护。
 */
import type { KeyboardEventHandler, ReactNode, RefObject } from 'react';
import { inputBarFontSize, searchLineHeight } from '../../shared/search-row-height';

export interface UnifiedTextareaProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  disabled: boolean;
  /** 单行行高(CSS px),来自设置 `ui.search_row_height`(默认 36,见 shared/search-row-height) */
  rowHeight: number;
  /** 自动增高上限(px),超过转框内滚动 */
  maxHeight: number;
  /** 下拉是否显示(combobox 的 aria-expanded) */
  dropdownShown: boolean;
  /** 下拉容器 id(aria-controls;仅在显示下拉时有意义) */
  dropdownId: string;
  /** 高亮行 id(aria-activedescendant;无候选行时给 null) */
  activeOptionId: string | null;
  /** 文本变化(组合中照常上报,第三个参数是原生事件:下游据其 isComposing 门控) */
  onChange: (raw: string, caret: number, nativeEvent: Event) => void;
  /** 光标/选区变化(链接触发判断需要当前光标,不只在输入时) */
  onSelect?: () => void;
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
      onChange={(e) => p.onChange(e.currentTarget.value, e.currentTarget.selectionStart ?? 0, e.nativeEvent)}
      // 组合结束:上屏文本按同口径再报一次(compositionend 不带 isComposing,下游据此恰好放行一次)
      onCompositionEnd={(e) => p.onChange(e.currentTarget.value, e.currentTarget.selectionStart ?? 0, e.nativeEvent)}
      onSelect={p.onSelect}
      onKeyDown={p.onKeyDown}
      style={{
        // 空输入时的行高 = 设置值;有内容后由宿主的 resize() 按 scrollHeight 改写
        height: p.rowHeight,
        lineHeight: `${searchLineHeight(p.rowHeight)}px`,
        // 字号与浮窗同一口径:行高/2(钳 15–28)。行高 36 → 18px(原来档位只给 14px)
        fontSize: `${inputBarFontSize(p.rowHeight)}px`,
        maxHeight: p.maxHeight,
        overflowY: 'auto',
      }}
      className="block min-w-0 flex-1 resize-none rounded-sm border border-border-strong bg-raised px-2.5 py-1.5 text-text outline-none"
    />
  );
}

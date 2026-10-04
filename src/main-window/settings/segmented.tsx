// 分段控件:多选一统一形状(设计 D4)。主题、色值页签、预设形态、阴影档位都用它。
// 保持 `aria-pressed` 的既有契约(旧按钮组就是这么标的,DOM 用例与验收脚本按它定位)。
import type { ReactNode } from 'react';

/** 选择按钮的基类(与旧 BTN_CHOICE 一致:8 高、6 圆角,选中态用 accent) */
export const BTN_CHOICE = 'h-8 shrink-0 rounded-sm border px-2 text-ui transition-colors ';

export function choiceState(active: boolean): string {
  return active ? 'border-accent bg-selected text-accent-text' : 'border-border-strong text-muted hover:border-accent';
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string | number> {
  value: T;
  options: readonly SegmentedOption<T>[];
  /** 无障碍名(group 的 aria-label),也是验收脚本的定位依据 */
  label: string;
  onChange: (value: T) => void;
}

/** 分段控件:一排按钮,只有当前项高亮;左右方向键可切换(键盘可达) */
export function Segmented<T extends string | number>({
  value,
  options,
  label,
  onChange,
}: SegmentedProps<T>): ReactNode {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (index < 0) return;
        e.preventDefault();
        const step = e.key === 'ArrowRight' ? 1 : -1;
        const next = options[(index + step + options.length) % options.length];
        onChange(next.value);
      }}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={BTN_CHOICE + choiceState(o.value === value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

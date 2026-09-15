// 设置页的控件:行容器(左标签+说明、右控件)、开关、百分比输入、下拉。
// 全部受控:变更即回调,没有"保存"按钮;输入框失焦时收敛并落库。
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { InputSettings } from '../../shared/input-settings';
import { STEP_MAX, STEP_MIN } from '../../shared/input-scale';
import type { SettingsRow } from './settings-model';

export interface SettingsRowProps {
  label: string;
  hint: string;
  children: ReactNode;
}

/** 一行设置:左侧标签与中文说明,右侧控件 */
export function SettingsRow({ label, hint, children }: SettingsRowProps): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-text">{label}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-faint">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export interface ToggleProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

export function Toggle({ checked, label, onChange }: ToggleProps): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        'relative h-6 w-11 rounded-full transition-colors ' +
        (checked ? 'bg-accent' : 'bg-text/20')
      }
    >
      <span
        className={
          'absolute top-0.5 h-5 w-5 rounded-full bg-knob shadow transition-all ' +
          (checked ? 'left-[22px]' : 'left-0.5')
        }
      />
    </button>
  );
}

export interface PercentInputProps {
  value: number;
  label: string;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}

/** 百分比输入:只接受整数,失焦(或回车)时收敛到区间并落库 */
export function PercentInput({ value, label, min, max, onCommit }: PercentInputProps): ReactNode {
  const [text, setText] = useState(String(value));

  // 外部值变化(如"恢复默认"或读取完成)时同步显示
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const t = text.trim();
    if (!/^-?\d+$/.test(t)) {
      setText(String(value)); // 空串或非整数:放弃编辑,显示原值
      return;
    }
    const clamped = Math.min(max, Math.max(min, Number(t)));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="h-8 w-16 rounded-md border border-border px-2 text-right text-sm outline-none focus:border-accent"
      />
      <span className="text-xs text-faint">%</span>
    </div>
  );
}

export interface SelectInputProps<T extends string> {
  value: string;
  label: string;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function SelectInput<T extends string>({
  value,
  label,
  options,
  onChange,
}: SelectInputProps<T>): ReactNode {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        // 只接受元数据里列出的白名单值:越界输入一律忽略(下拉本不该产生越界值)
        const hit = options.find((o) => o.value === e.target.value);
        if (hit) onChange(hit.value);
      }}
      className="h-8 rounded-md border border-border bg-raised px-2 text-sm text-muted outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export interface RowControlProps {
  row: SettingsRow;
  value: InputSettings[keyof InputSettings];
  onChange: (key: keyof InputSettings, value: InputSettings[keyof InputSettings]) => void;
}

/** 按行的 kind 选择控件(值与键的对应关系由 inputRows 的元数据保证) */
export function RowControl({ row, value, onChange }: RowControlProps): ReactNode {
  if (row.kind === 'toggle') {
    return <Toggle checked={value === true} label={row.label} onChange={(v) => onChange(row.key, v)} />;
  }
  if (row.kind === 'select') {
    return (
      <SelectInput
        value={String(value)}
        label={row.label}
        options={row.options ?? []}
        onChange={(v) => onChange(row.key, v)}
      />
    );
  }
  // 数值行的区间由 settings-model 的元数据显式给出(真源是 shared/input-scale 的
  // STEP_*/OPACITY_*)。缺失时退回步长区间而不是再造一套字面量兜底常量(旧实现写死
  // {min:1,max:50},是第二真源);新增 percent 行必须自带 range。
  const range = row.range ?? { min: STEP_MIN, max: STEP_MAX };
  return (
    <PercentInput
      value={typeof value === 'number' ? value : Number(value)}
      label={row.label}
      min={range.min}
      max={range.max}
      onCommit={(n) => onChange(row.key, n)}
    />
  );
}

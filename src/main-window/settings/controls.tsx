// 设置页的控件:行容器(左标签+说明、右控件)、开关、百分比输入、下拉。
// 全部受控:变更即回调,没有"保存"按钮;输入框失焦时收敛并落库。
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { QuickSettings } from '../../shared/quick-settings';
import type { SelectValue, SettingsRow } from './settings-model';

export interface SettingsRowProps {
  label: string;
  hint: string;
  children: ReactNode;
}

/** 一行设置:左侧标签与中文说明,右侧控件 */
export function SettingsRow({ label, hint, children }: SettingsRowProps): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-gray-900">{label}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-gray-500">{hint}</div>
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
        (checked ? 'bg-blue-600' : 'bg-gray-300')
      }
    >
      <span
        className={
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' +
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
        className="h-8 w-16 rounded-md border border-gray-300 px-2 text-right text-sm outline-none focus:border-blue-500"
      />
      <span className="text-xs text-gray-500">%</span>
    </div>
  );
}

export interface SelectInputProps {
  value: string;
  label: string;
  options: { value: SelectValue; label: string }[];
  onChange: (value: SelectValue) => void;
}

export function SelectInput({ value, label, options, onChange }: SelectInputProps): ReactNode {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'hide' || v === 'none') onChange(v);
      }}
      className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 outline-none focus:border-blue-500"
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
  value: QuickSettings[keyof QuickSettings];
  onChange: (key: keyof QuickSettings, value: QuickSettings[keyof QuickSettings]) => void;
}

/** 按行的 kind 选择控件(值与键的对应关系由 quickRows 的元数据保证) */
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
  const range = row.range ?? { min: 1, max: 50 };
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

// 「外观」段落的控件:预设一排按钮、阴影四档、数值滑块、颜色色块(点开色盘浮层)。
// 全部受控:变更即回调,没有「保存」按钮。尺寸/圆角逐字复用设置页既有档位(h-8 / rounded-sm)。
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PresetId, ShadowLevel } from '../../shared/input-appearance';
import {
  PRESET_ORDER,
  PRESETS,
  SHADOW_LABELS,
  type BuiltinPreset,
} from '../../shared/input-appearance-presets';
import { ColorPopover } from './color-popover';
import './appearance-controls.css';

/** 选择按钮(预设/阴影/页签共用)的基类:8 高与 6 圆角,命名贴 V4 按钮门禁口径(BTN_)。
 *  选中/未选中的颜色类由 choiceState 给,JSX 里写 `BTN_CHOICE + choiceState(x)`。 */
export const BTN_CHOICE = 'h-8 shrink-0 rounded-sm border px-2 text-ui transition-colors ';

export function choiceState(active: boolean): string {
  return active ? 'border-accent bg-selected text-accent-text' : 'border-border-strong text-muted hover:border-accent';
}

export interface PresetButtonsProps {
  value: PresetId;
  onPick: (id: BuiltinPreset) => void;
}

/** 四套预设一排按钮;当前值高亮(预设为 custom 时四个都不亮) */
export function PresetButtons({ value, onPick }: PresetButtonsProps): ReactNode {
  return (
    <div className="flex gap-1">
      {PRESET_ORDER.map((id) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onPick(id)} className={BTN_CHOICE + choiceState(value === id)}>
          {PRESETS[id].label}
        </button>
      ))}
    </div>
  );
}

export interface ShadowButtonsProps {
  value: ShadowLevel;
  onPick: (value: ShadowLevel) => void;
}

/** 阴影四档:无 / 轻 / 中 / 强 */
export function ShadowButtons({ value, onPick }: ShadowButtonsProps): ReactNode {
  return (
    <div className="flex gap-1">
      {SHADOW_LABELS.map((label, level) => (
        <button key={label} type="button" aria-pressed={value === level} onClick={() => onPick(level as ShadowLevel)} className={BTN_CHOICE + choiceState(value === level)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  suffix?: string;
  onCommit: (value: number) => void;
}

/** 原生 range:拖动即回调(每个 input 事件都写库),右侧显示当前值与单位 */
export function RangeSlider({ value, min, max, step, label, suffix = '', onCommit }: RangeSliderProps): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onCommit(Number(e.currentTarget.value))}
        className="h-8 w-32 rounded-sm border border-border-strong text-ui"
      />
      <span className="w-12 text-right text-ui text-muted">
        {value}
        {suffix}
      </span>
    </div>
  );
}

export interface ColorSwatchProps {
  value: string;
  label: string;
  allowTransparent: boolean;
  onChange: (value: string) => void;
}

/** 色块按钮:点开色盘浮层;预览块用色值本身(透明/主题用类名或令牌,不写死进制) */
export function ColorSwatch({ value, label, allowTransparent, onChange }: ColorSwatchProps): ReactNode {
  const [open, setOpen] = useState(false);
  const plain = value === 'theme' || value === 'surface';
  const transparent = value === 'transparent';
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 items-center gap-2 rounded-sm border border-border-strong px-2 text-ui text-muted transition-colors hover:border-accent"
      >
        <span
          className={'block h-4 w-4 rounded-xs border border-border ' + (transparent ? 'swatch-transparent' : plain ? 'bg-raised' : '')}
          style={transparent || plain ? undefined : { backgroundColor: value }}
        />
        <span>色盘</span>
      </button>
      {open && (
        <ColorPopover
          value={value}
          allowTransparent={allowTransparent}
          label={label}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

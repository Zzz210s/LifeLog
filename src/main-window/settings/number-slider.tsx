// 数值设置统一控件:滑块 + 右侧数字(设计 D3)。
// 滑块给直觉、数字给精度;两者共用同一个区间与步长,改任一边都立刻落库。
// 数字框沿用旧 PercentInput 的口径:失焦/回车收敛到区间,非整数放弃编辑。
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface NumberSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  /** 无障碍名(滑块与数字框都用它),也是验收脚本的定位依据 */
  label: string;
  /** 数字后的单位,如 px / % */
  suffix?: string;
  onCommit: (value: number) => void;
}

export function NumberSlider({
  value,
  min,
  max,
  step,
  label,
  suffix = '',
  onCommit,
}: NumberSliderProps): ReactNode {
  const [text, setText] = useState(String(value));

  // 外部值变化(恢复默认、读设置完成、拖滑块)时同步显示
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const clamp = (n: number): number => Math.min(max, Math.max(min, n));
  const commit = (): void => {
    const t = text.trim();
    if (!/^-?\d+$/.test(t)) {
      setText(String(value)); // 空串或非整数:放弃编辑,显示原值
      return;
    }
    const next = clamp(Number(t));
    setText(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onCommit(clamp(Number(e.target.value)))}
        className="h-4 w-40 accent-accent"
      />
      <input
        type="text"
        inputMode="numeric"
        value={text}
        aria-label={label + '数值'}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="h-8 w-14 rounded-sm border border-border-strong px-2 text-right text-ui outline-none"
      />
      {suffix !== '' && <span className="text-label text-muted">{suffix}</span>}
    </div>
  );
}

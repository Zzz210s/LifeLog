// 「输入栏外观」分区的控件:色块(点开色盘浮层)。预设/阴影/数值都改用统一控件:
//   预设形态、阴影档位 -> Segmented(分段控件)
//   圆角、透明度 -> NumberSlider(滑块 + 数字)
// 这里保留 ColorSwatch 与两个兼容导出(旧的 BTN_CHOICE/choiceState 与 RangeSlider 名),
// 免得既有用例与引用点全都要改;新代码请直接从 segmented.tsx / number-slider.tsx 取。
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ColorPopover } from './color-popover';
import './appearance-controls.css';

export { BTN_CHOICE, choiceState, Segmented } from './segmented';
export { NumberSlider as RangeSlider } from './number-slider';

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

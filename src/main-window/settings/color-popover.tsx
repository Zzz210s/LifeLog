// 色盘浮层:13 格(12 色 + 透明格,7 列 x 2 行)与一个原生取色器。
// Esc / 点外部关闭;透明格只在 allowTransparent 时出现(边框不提供透明格)。
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { PALETTE } from '../../shared/input-appearance-presets';

export interface ColorPopoverProps {
  value: string;
  allowTransparent: boolean;
  label: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

export function ColorPopover({ value, allowTransparent, label, onChange, onClose }: ColorPopoverProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 先吃掉:不要让 Esc 冒泡到窗口级(设置页的 Esc 返回、输入栏的隐藏都在那里)
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  const cells = allowTransparent ? PALETTE : PALETTE.filter((cell) => cell !== 'transparent');
  const nativeValue = value.startsWith('#') ? value : '#000000';

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label + '色盘'}
      className="absolute right-0 z-10 mt-1 grid w-64 grid-cols-7 gap-1 rounded-lg border border-border bg-raised p-2 shadow-lg"
    >
      {cells.map((cell) => {
        const active = value === cell;
        return (
          <button
            key={cell}
            type="button"
            role="menuitem"
            aria-label={cell === 'transparent' ? '透明' : '颜色 ' + cell}
            aria-pressed={active}
            onClick={() => {
              onChange(cell);
              onClose();
            }}
            style={cell === 'transparent' ? undefined : { backgroundColor: cell }}
            className={'h-7 w-7 rounded-xs border ' + (cell === 'transparent' ? 'swatch-transparent ' : '') + (active ? 'border-accent' : 'border-border')}
          />
        );
      })}
      <label className="col-span-7 mt-1 flex items-center justify-between gap-2 text-label text-muted">
        自定义
        <input
          type="color"
          aria-label="自定义颜色"
          value={nativeValue}
          onChange={(e) => onChange(e.currentTarget.value)}
          className="h-8 w-16 rounded-sm border border-border-strong text-ui"
        />
      </label>
    </div>
  );
}

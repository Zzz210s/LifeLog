/**
 * 标签页栏的「+」菜单(spec 2026-09-17 S7):三个预设(全部 / 待办 / 无标签)
 * 加「把当前筛选开成新标签页」。菜单交互与筛选栏的添加条件菜单同款:
 * 点击菜单外或 Esc 关闭。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PresetKey } from './tab-presets';
import { TAB_PRESETS } from './tab-presets';

export interface TabAddMenuProps {
  onPreset: (key: PresetKey) => void;
  onAddCurrent: () => void;
}

// 视觉口径(V5 收口):rounded-xs(4px)+ text-ui(13/18)+ 中性 hover;选中态才用 accent
const ITEM_CLASS =
  'block w-full rounded-xs px-2 py-1.5 text-left text-ui text-text hover:bg-hover hover:text-text';

export function TabAddMenu(p: TabAddMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const act = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="新建标签页(预设或当前筛选)"
        aria-label="新建标签页"
        className="h-7 rounded-sm px-2 text-ui text-muted hover:bg-hover hover:text-text"
      >
        +
      </button>
      {open && (
        <div
          role="menu"
          aria-label="新建标签页"
          className="absolute left-0 top-8 z-20 w-52 rounded-lg border border-border bg-app p-1 shadow-lg"
        >
          {TAB_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              role="menuitem"
              data-preset={preset.key}
              onClick={() => act(() => p.onPreset(preset.key))}
              className={ITEM_CLASS}
            >
              打开预设: {preset.title}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            data-preset="current"
            onClick={() => act(p.onAddCurrent)}
            className={ITEM_CLASS}
          >
            把当前筛选开成新标签页
          </button>
        </div>
      )}
    </div>
  );
}

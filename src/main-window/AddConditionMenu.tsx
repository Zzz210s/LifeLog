import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../shared/filter-conditions';

export interface AddConditionMenuProps {
  conditions: FilterConditions;
  /** 局部更新(日期/有无标签/排序在菜单内直接生效) */
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 标签/排除标签:交给上层打开标签选择器 */
  onPickTag: (exclude: boolean) => void;
}

type Pane = 'main' | 'date' | 'presence' | 'sort';

const ITEM_CLASS =
  'block w-full rounded px-2.5 py-1.5 text-left text-xs text-muted hover:bg-accent-soft hover:text-accent-text';

/** 「添加条件」下拉:主面板五项;日期/有无标签/排序切换到子面板直接生效 */
export function AddConditionMenu(p: AddConditionMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>('main');
  const root = useRef<HTMLDivElement>(null);

  // 开着时:点击菜单外或 Esc 关闭(不冒泡到窗口级)
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

  const close = () => {
    setOpen(false);
    setPane('main');
  };
  const act = (fn: () => void) => {
    fn();
    close();
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-8 rounded-md border border-border px-2.5 text-xs text-muted hover:border-accent hover:text-accent-text"
      >
        添加条件
        <svg viewBox="0 0 16 16" className="ml-1 inline h-3 w-3 align-[-1px]" aria-hidden="true">
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 rounded-md border border-border bg-raised p-1 shadow-lg"
        >
          {pane === 'main' && (
            <>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => act(() => p.onPickTag(false))}>
                标签
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => act(() => p.onPickTag(true))}>
                排除标签
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => setPane('date')}>
                日期范围
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => setPane('presence')}>
                有无标签
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => setPane('sort')}>
                排序
              </button>
            </>
          )}
          {pane === 'date' && (
            <div className="flex items-center gap-1.5 p-1 text-xs text-muted">
              <span>从</span>
              <input
                type="date"
                aria-label="开始日期"
                value={p.conditions.from ?? ''}
                onChange={(e) => p.onPatch({ from: e.target.value === '' ? null : e.target.value })}
                className="h-7 rounded border border-border px-1.5 text-xs"
              />
              <span>至</span>
              <input
                type="date"
                aria-label="结束日期"
                value={p.conditions.to ?? ''}
                onChange={(e) => p.onPatch({ to: e.target.value === '' ? null : e.target.value })}
                className="h-7 rounded border border-border px-1.5 text-xs"
              />
              <button type="button" onClick={close} className="rounded border border-border px-2 py-0.5 hover:border-accent hover:text-accent-text">
                完成
              </button>
            </div>
          )}
          {pane === 'presence' && (
            <>
              {([
                [null, '不限'],
                ['any', '有标签'],
                ['none', '无自定义标签'],
              ] as const).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  className={ITEM_CLASS + (p.conditions.tagPresence === v ? ' bg-accent-soft text-accent-text' : '')}
                  onClick={() => act(() => p.onPatch({ tagPresence: v }))}
                >
                  {label}
                </button>
              ))}
            </>
          )}
          {pane === 'sort' && (
            <>
              {(['newest', 'oldest'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="menuitem"
                  className={ITEM_CLASS + (p.conditions.sort === v ? ' bg-accent-soft text-accent-text' : '')}
                  onClick={() => act(() => p.onPatch({ sort: v }))}
                >
                  {v === 'newest' ? '最新在前' : '最早在前'}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

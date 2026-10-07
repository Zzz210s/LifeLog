/**
 * 条件栏的排序入口(2026-10-07 盘点报告):原先「最新在前 / 最早在前」两条快捷项藏在顶栏 `⋯` 里,
 * 既与视图内动作错位、又是两份 UI 口径。现在收敛成条件栏上的一个图标按钮,打开既有的 `SortPanel`
 * (多条件排序,与「添加条件」浮层里那条 `排序` 是同一个组件,只是这里就近常驻)。
 *
 * 开关与关闭手势复用 `useDismiss`(点外部 / Esc),与 AddConditionMenu 同一实现。
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import { BTN_ICON } from '../shell/button-classes';
import { useDismiss } from '../shell/use-dismiss';
import { SortPanel } from './SortPanel';

export interface SortMenuButtonProps {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
}

/** 24 格 / 2 描边:上下双箭头 = 排序 */
const SORT_PATH = 'm21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16';

export function SortMenuButton(p: SortMenuButtonProps): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, root, () => setOpen(false));

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="排序"
        aria-label="排序"
        aria-haspopup="menu"
        aria-expanded={open}
        className={BTN_ICON + (open ? ' bg-selected text-accent-text' : '')}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-4 w-4"
        >
          <path d={SORT_PATH} />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="排序"
          data-testid="sort-menu"
          className="absolute left-0 top-full z-20 mt-1 rounded-lg border border-border bg-raised p-2 shadow-lg"
        >
          <SortPanel conditions={p.conditions} onPatch={p.onPatch} />
        </div>
      )}
    </div>
  );
}

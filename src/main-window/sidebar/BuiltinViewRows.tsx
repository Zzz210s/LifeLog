/**
 * 侧栏「视图」分区的内置三行(全部 / 待办 / 无自定义标签):固定图标、只读、右侧命中徽标。
 * 从 ViewsSection 拆出以守 200 行上限;条件与图标都是前端常量(builtin-views.ts),不入库。
 */
import type { ReactNode } from 'react';
import { filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { ViewIcon } from '../view-icons';
import { BUILTIN_VIEWS } from './builtin-views';

export interface BuiltinViewRowsProps {
  /** 当前条件的键(与各行条件比对决定高亮) */
  currentKey: string;
  /** 命中徽标(查不到时为「—」) */
  badge: (key: string) => string;
  onApply: (c: FilterConditions) => void;
}

const ROW =
  'flex w-full items-center gap-1.5 rounded px-1.5 py-1 pr-2 text-left text-xs transition-colors ';

export function BuiltinViewRows(p: BuiltinViewRowsProps): ReactNode {
  return BUILTIN_VIEWS.map((v) => (
    <button
      type="button"
      key={v.key}
      data-view-key={v.key}
      onClick={() => p.onApply(v.conditions)}
      title={`视图:${v.title}`}
      className={
        ROW +
        (filterKey(v.conditions) === p.currentKey
          ? 'bg-accent-soft text-accent-text'
          : 'text-muted hover:bg-accent-soft hover:text-accent-text')
      }
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        <ViewIcon name={v.icon} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 truncate">{v.title}</span>
      <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-faint">{p.badge(v.key)}</span>
    </button>
  ));
}

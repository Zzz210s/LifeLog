import type { ReactNode } from 'react';

export interface GroupHeaderProps {
  /** 组名(末段名;哨兵组为 `（无 轴末段名）`) */
  label: string;
  /** 完整路径(长名被截断时由 title 兜底);哨兵组不传则用 label */
  title?: string;
  /** 该组在当前条件下的总数(不是已加载数) */
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * 分组组头(设计 §6.2):折叠箭头 + 组名 + 条数。
 * 整行是原生 `<button>`(可聚焦、Enter/Space 可切),`aria-expanded` 表达折叠态 ——
 * 不用 div + onClick,键盘用户否则无法折叠。
 */
export function GroupHeader(p: GroupHeaderProps): ReactNode {
  return (
    <button
      type="button"
      data-testid="group-header"
      aria-expanded={!p.collapsed}
      title={p.title ?? p.label}
      onClick={p.onToggle}
      className="flex w-full items-center gap-2 rounded-xs px-1.5 py-1 text-left text-ui text-text transition-colors hover:bg-hover"
    >
      <span aria-hidden="true" className="text-muted">
        {p.collapsed ? '▸' : '▾'}
      </span>
      <span className="min-w-0 flex-1 truncate">{p.label}</span>
      <span data-testid="group-count" className="shrink-0 text-label text-muted">
        {p.count} 条
      </span>
    </button>
  );
}

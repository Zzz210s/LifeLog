/**
 * 「时间」分区单行(spec 4.5):按层级缩进 12px/级、右侧显示子树计数,
 * 点击即按该时段筛选(含子级);年份/月份同样可点(计数已含子孙)。
 * 时间标签由系统维护:不可拖拽、不出右键管理菜单。
 */
import type { ReactNode } from 'react';
import type { TagNode } from './tag-tree';

export interface TimeRowProps {
  node: TagNode;
  /** 已在引入侧(与本行 path 一致) */
  selected: boolean;
  /** 已在排除侧:淡红底 + 「已排除」角标 */
  excluded: boolean;
  expanded: boolean;
  /** 行点击:按该时段筛选(路径 + 含子级),与标签分区同一条件对象 */
  onPick: (path: string) => void;
  onToggleExpand: (path: string) => void;
}

export function TimeRow(p: TimeRowProps): ReactNode {
  const hasChildren = p.node.children.length > 0;
  const rowClass =
    'group flex w-full items-center gap-1 rounded px-1.5 py-1 pr-2 text-left text-xs transition-colors ' +
    (p.excluded
      ? 'bg-red-50 text-red-700 hover:bg-red-100'
      : p.selected
        ? 'bg-blue-100 text-blue-700'
        : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700');

  return (
    <button
      type="button"
      data-time-path={p.node.path}
      data-selected={p.selected ? 'true' : undefined}
      draggable={false}
      aria-pressed={p.selected}
      title={`${p.node.path}(含子级 ${p.node.subtreeCount})`}
      className={rowClass}
      style={{ paddingLeft: 6 + (p.node.depth - 1) * 12 }}
      onClick={() => p.onPick(p.node.path)}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {hasChildren ? (
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={'w-3 h-3 shrink-0 text-gray-400 transition-transform ' + (p.expanded ? 'rotate-90' : '')}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleExpand(p.node.path);
          }}
        >
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <span className="min-w-0 truncate">{p.node.name}</span>
      {p.excluded && (
        <span className="shrink-0 rounded bg-red-100 px-1 text-[10px] leading-4 text-red-600">已排除</span>
      )}
      <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-gray-400">{p.node.subtreeCount}</span>
    </button>
  );
}

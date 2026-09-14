/**
 * 标签树单行(spec 6.1 标签分区):树模式按层级缩进 12px/级、带展开箭头与计数导轨;
 * 扁平模式不缩进、显示完整路径。选中态与条件对象同源(由上层派生传入)。
 * 结构节点(本级 0 且有子级)只可展开不可选,行点击交给 onToggleExpand。
 */
import type { ReactNode } from 'react';
import type { TagNode } from './tag-tree';
import { isSelectable } from './tag-tree';

export interface TagRowProps {
  node: TagNode;
  /** 扁平模式:不缩进、无箭头、显示完整路径 */
  flat: boolean;
  selected: boolean;
  expanded: boolean;
  /** 行点击(可选中时 = 加入/移出筛选) */
  onToggle: (node: TagNode) => void;
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TagNode) => void;
}

const COUNT_RAIL_CLASS = 'ml-auto shrink-0 pl-2 text-xs tabular-nums text-gray-400';

export function TagRow(p: TagRowProps): ReactNode {
  const selectable = isSelectable(p.node);
  const hasChildren = p.node.children.length > 0;
  const label = p.flat ? p.node.path : p.node.name;
  const rowClass =
    'group flex w-full items-center gap-1 rounded px-1.5 py-1 pr-2 text-left text-xs transition-colors ' +
    (selectable
      ? p.selected
        ? 'bg-blue-100 text-blue-700'
        : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
      : 'cursor-default text-gray-400 hover:bg-gray-100');

  return (
    <button
      type="button"
      data-tag-path={p.node.path}
      aria-pressed={selectable ? p.selected : undefined}
      title={`${p.node.path}(本级 ${p.node.selfCount} / 含子级 ${p.node.subtreeCount})`}
      className={rowClass}
      style={{ paddingLeft: p.flat ? 6 : 6 + (p.node.depth - 1) * 12 }}
      onClick={() => (selectable ? p.onToggle(p.node) : hasChildren && p.onToggleExpand(p.node.path))}
      onContextMenu={(e) => p.onContextMenu(e, p.node)}
    >
      {!p.flat && hasChildren && (
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
      )}
      {!p.flat && !hasChildren && <span className="w-3 shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
      <span className={COUNT_RAIL_CLASS}>{p.node.subtreeCount}</span>
    </button>
  );
}

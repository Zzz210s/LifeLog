/**
 * 标签树单行(spec 6.1 标签分区):树模式按层级缩进 12px/级、带展开箭头与计数导轨;
 * 扁平模式不缩进、显示完整路径。选中态与条件对象同源(由上层派生传入)。
 * 结构节点(本级 0 且有子级)只可展开不可选,行点击交给 onToggleExpand。
 * 拖拽(spec 6):真实标签行(id 非 null)draggable;拖动源半透明,
 * 悬停目标加底部色带(将成为其子级)。
 */
import type { ReactNode } from 'react';
import type { TagNode } from './tag-tree';
import { isSelectable } from './tag-tree';

export interface TagRowProps {
  node: TagNode;
  /** 扁平模式:不缩进、无箭头、显示完整路径 */
  flat: boolean;
  selected: boolean;
  /** 已在排除侧:淡红底 + 「已排除」角标(点击 = 撤掉该排除,与选中态区分) */
  excluded: boolean;
  expanded: boolean;
  /** 行点击(可选中时 = 加入/移出筛选) */
  onToggle: (node: TagNode) => void;
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TagNode) => void;
  /** 拖拽:本行是拖动源(半透明) */
  dragSource: boolean;
  /** 拖拽:本行是当前悬停目标(底部色带 = 将成为其子级) */
  dropTarget: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

const COUNT_RAIL_CLASS = 'ml-auto shrink-0 pl-2 text-xs tabular-nums text-faint';

export function TagRow(p: TagRowProps): ReactNode {
  const selectable = isSelectable(p.node);
  const hasChildren = p.node.children.length > 0;
  const label = p.flat ? p.node.path : p.node.name;
  const rowClass =
    'group flex w-full items-center gap-1 rounded px-1.5 py-1 pr-2 text-left text-xs transition-colors ' +
    (selectable
      ? p.excluded
        ? 'bg-danger-soft text-danger hover:bg-danger/20'
        : p.selected
          ? 'bg-accent-soft text-accent'
          : 'text-muted hover:bg-accent-soft hover:text-accent'
      : 'cursor-default text-faint hover:bg-hover') +
    (p.dropTarget ? ' shadow-[inset_0_-3px_0_var(--color-accent)]' : '') +
    (p.dragSource ? ' opacity-40' : '');

  return (
    <button
      type="button"
      data-tag-path={p.node.path}
      data-drag-source={p.dragSource ? 'true' : undefined}
      data-drop-target={p.dropTarget ? 'true' : undefined}
      draggable={p.node.id !== null}
      aria-pressed={selectable ? p.selected : undefined}
      title={`${p.node.path}(本级 ${p.node.selfCount} / 含子级 ${p.node.subtreeCount})`}
      className={rowClass}
      style={{ paddingLeft: p.flat ? 6 : 6 + (p.node.depth - 1) * 12 }}
      onClick={() => (selectable ? p.onToggle(p.node) : hasChildren && p.onToggleExpand(p.node.path))}
      onContextMenu={(e) => p.onContextMenu(e, p.node)}
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
    >
      {!p.flat && hasChildren && (
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={'w-3 h-3 shrink-0 text-faint transition-transform ' + (p.expanded ? 'rotate-90' : '')}
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
      {p.excluded && (
        <span className="shrink-0 rounded bg-danger-soft px-1 text-[10px] leading-4 text-danger">已排除</span>
      )}
      <span className={COUNT_RAIL_CLASS}>{p.node.subtreeCount}</span>
    </button>
  );
}

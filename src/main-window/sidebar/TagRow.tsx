/**
 * 标签树单行(spec 6.1 标签分区):树模式按层级缩进 12px/级、带展开箭头与计数导轨;
 * 扁平模式不缩进、显示完整路径。选中态与条件对象同源(由上层派生传入)。
 * 结构节点(含子级计数 0)只可展开不可选,行点击交给 onToggleExpand。
 *
 * 拖拽(T3/T5,2026-09-21 重做):真实标签行(id 非 null)draggable;
 * - **整行 = 成为其子级**:悬停即整行背景高亮(主题 token,无边框/色带);
 * - 同级插入的 1px 指示线由 TagDropBand 画;本行只兜底画"冒泡到这里"的同级线(before/after),
 *   几何与边界带完全一致(边界 y + 按层级缩进),所以即使两者同时命中也是同一条线;
 * - 源行不再改透明度(VS Code 源行没有任何半透明处理),拖拽中抑制 hover 高亮。
 */
import type { ReactNode } from 'react';
import type { TagNode } from './tag-tree';
import { isSelectable } from './tag-tree';
import type { DropZone } from './drag-check';

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
  /** 拖拽:本行是拖动源 */
  dragSource: boolean;
  /** 拖拽:本行的落点分区(child = 成为子级整行高亮;before/after = 冒泡来的同级指示线) */
  dropZone: DropZone | null;
  /** 拖拽进行中:抑制 hover 高亮(VS Code 的 .dragging 类口径) */
  dragActive: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  /** 行离开(100ms 防抖清落点的入口) */
  onDragLeave: (e: React.DragEvent) => void;
}

const COUNT_RAIL_CLASS = 'ml-auto shrink-0 pl-2 text-xs tabular-nums text-faint';

/** 行的左内边距 = 同级插入线的左端(扁平 6、树 6 + (depth-1)*12),两处必须同源 */
export function lineIndent(node: TagNode, flat: boolean): number {
  return flat ? 6 : 6 + (node.depth - 1) * 12;
}

export function TagRow(p: TagRowProps): ReactNode {
  const selectable = isSelectable(p.node);
  const hasChildren = p.node.children.length > 0;
  const label = p.flat ? p.node.path : p.node.name;
  const state = p.excluded
    ? 'bg-danger-soft text-danger hover:bg-danger/20'
    : p.selected
      ? 'bg-accent-soft text-accent-text'
      : p.dragActive
        ? 'text-muted'
        : 'text-muted hover:bg-accent-soft hover:text-accent-text';
  const rowClass =
    'group relative flex w-full items-center gap-1 rounded px-1.5 py-1 pr-2 text-left text-xs transition-colors ' +
    (selectable ? state : 'cursor-default text-faint' + (p.dragActive ? '' : ' hover:bg-hover')) +
    (p.dropZone === 'child' ? ' bg-accent-soft' : '');

  return (
    <button
      type="button"
      data-tag-path={p.node.path}
      data-drag-source={p.dragSource ? 'true' : undefined}
      data-drop-target={p.dropZone ?? undefined}
      draggable={p.node.id !== null}
      aria-pressed={selectable ? p.selected : undefined}
      title={`${p.node.path}(本级 ${p.node.selfCount} / 含子级 ${p.node.subtreeCount})`}
      className={rowClass}
      style={{ paddingLeft: lineIndent(p.node, p.flat) }}
      onClick={() => (selectable ? p.onToggle(p.node) : hasChildren && p.onToggleExpand(p.node.path))}
      onContextMenu={(e) => p.onContextMenu(e, p.node)}
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
      onDragOver={p.onDragOver}
      onDragLeave={p.onDragLeave}
      onDrop={p.onDrop}
    >
      {p.dropZone === 'before' && (
        <span
          aria-hidden="true"
          data-drop-line="before"
          className="pointer-events-none absolute right-0 top-0 h-px bg-accent"
          style={{ left: lineIndent(p.node, p.flat) }}
        />
      )}
      {p.dropZone === 'after' && (
        <span
          aria-hidden="true"
          data-drop-line="after"
          className="pointer-events-none absolute bottom-0 right-0 h-px bg-accent"
          style={{ left: lineIndent(p.node, p.flat) }}
        />
      )}
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

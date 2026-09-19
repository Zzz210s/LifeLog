/**
 * 标签行列表(spec 6.1):树模式递归展开子级,扁平模式按传入的深度优先序列平铺。
 * 两模式的差异只有 flat 与 expanded(扁平模式恒不展开),行本身的行为全在 TagRow;
 * 抽成同级组件是为让 TagsSection 留在 200 行内,渲染结果与内联写法完全一致。
 *
 * 拖拽进行中额外在每行之前叠一条同级插入热区(TagGapDrop,负边距不占布局),
 * 并在列表末尾补一条(插到最后一行之后);行的缩进决定插入线的左端,见 TagGapDrop。
 */
import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { TagRow } from './TagRow';
import { TagGapDrop } from './TagGapDrop';
import type { TagNode } from './tag-tree';
import type { useTagDrag } from './use-tag-drag';

export interface TagRowListProps {
  /** 树模式传嵌套树,扁平模式传拉平后的深度优先序列 */
  nodes: TagNode[];
  /** 扁平模式:不缩进、无箭头、显示完整路径 */
  flat: boolean;
  /** 选中(引入侧)路径集合,与筛选条件同源 */
  selected: Set<string>;
  /** 排除侧路径集合(淡红底 + 角标) */
  excluded: Set<string>;
  /** 树模式下的展开判定(过滤态恒展开);扁平模式不使用 */
  expanded: (path: string) => boolean;
  onToggle: (node: TagNode) => void;
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TagNode) => void;
  /** 拖拽状态与行事件(源行半透明、悬停目标色带) */
  drag: ReturnType<typeof useTagDrag>;
}

/** 插入线左端:与 TagRow 的 paddingLeft 同源(扁平 6、树 6 + (depth-1)*12) */
function indentOf(node: TagNode, flat: boolean): number {
  return flat ? 6 : 6 + (node.depth - 1) * 12;
}

export function TagRowList(p: TagRowListProps): ReactNode {
  /** 按显示序拉平可见行(树模式只含已展开的层级),便于在相邻行之间插入热区 */
  const visible: TagNode[] = [];
  const walk = (nodes: TagNode[]): void => {
    for (const n of nodes) {
      visible.push(n);
      if (!p.flat && n.children.length > 0 && p.expanded(n.path)) walk(n.children);
    }
  };
  walk(p.nodes);

  const gap = (node: TagNode, zone: 'before' | 'after'): ReactNode => {
    const active = p.drag.overPath === node.path && p.drag.overZone === zone;
    return (
      <TagGapDrop
        key={`gap-${zone}-${node.path}`}
        path={node.path}
        zone={zone}
        active={active}
        lineLeft={indentOf(node, p.flat)}
        onDragOver={(e) => p.drag.gapEvents.onDragOverGap(e, node, zone)}
        onDrop={(e) => p.drag.gapEvents.onDropGap(e, node, zone)}
      />
    );
  };

  const last = visible[visible.length - 1];

  return (
    <>
      {visible.map((node) => (
        <Fragment key={node.path}>
          {p.drag.dragging && gap(node, 'before')}
          <TagRow
            node={node}
            flat={p.flat}
            selected={p.selected.has(node.path)}
            excluded={p.excluded.has(node.path)}
            expanded={!p.flat && p.expanded(node.path)}
            onToggle={p.onToggle}
            onToggleExpand={p.onToggleExpand}
            onContextMenu={p.onContextMenu}
            dragSource={p.drag.sourcePath === node.path}
            dropZone={p.drag.overPath === node.path ? p.drag.overZone : null}
            onDragStart={(e) => p.drag.rowEvents.onDragStartRow(e, node)}
            onDragEnd={p.drag.rowEvents.onDragEnd}
            onDragOver={(e) => p.drag.rowEvents.onDragOverRow(e, node)}
            onDrop={(e) => p.drag.rowEvents.onDropRow(e, node)}
          />
        </Fragment>
      ))}
      {p.drag.dragging && last && gap(last, 'after')}
    </>
  );
}

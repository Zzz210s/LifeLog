/**
 * 标签行列表(spec 6.1):树模式递归展开子级,扁平模式按传入的深度优先序列平铺。
 * 两模式的差异只有 flat 与 expanded(扁平模式恒不展开),行本身的行为全在 TagRow;
 * 抽成同级组件是为让 TagsSection 留在 200 行内,渲染结果与内联写法完全一致。
 */
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { TagRow } from './TagRow';
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

export function TagRowList(p: TagRowListProps): ReactNode {
  const row = (node: TagNode, flat: boolean): ReactNode => (
    <TagRow
      key={node.path}
      node={node}
      flat={flat}
      selected={p.selected.has(node.path)}
      excluded={p.excluded.has(node.path)}
      expanded={!flat && p.expanded(node.path)}
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
  );

  if (p.flat) return <>{p.nodes.map((n) => row(n, true))}</>;

  const tree = (nodes: TagNode[]): ReactNode =>
    nodes.map((n) => (
      <Fragment key={n.path}>
        {row(n, false)}
        {n.children.length > 0 && p.expanded(n.path) && tree(n.children)}
      </Fragment>
    ));
  return <>{tree(p.nodes)}</>;
}

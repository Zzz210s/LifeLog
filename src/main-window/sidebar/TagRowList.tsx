/**
 * 标签行列表(spec 6.1):树模式递归展开子级,扁平模式按传入的深度优先序列平铺。
 * 两模式的差异只有 flat 与 expanded(扁平模式恒不展开),行本身的行为全在 TagRow;
 * 抽成同级组件是为让 TagsSection 留在 200 行内,渲染结果与内联写法完全一致。
 *
 * 拖拽进行中在相邻行之间渲染同级插入边界带(TagDropBand,负边距不占布局):
 * 每行之前一条 + 列表末尾一条;带的两半 = "插到上一行之后" / "插到下一行之前"。
 * 源行在拖拽中消失(如被折叠/被过滤)时清掉拖拽态(T6 兜底:不留残留热区)。
 */
import type { ReactNode } from 'react';
import { Fragment, useEffect } from 'react';
import { TagRow } from './TagRow';
import { TagDropBand } from './TagDropBand';
import { bandHalves } from './drag-resolve';
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
  /** 拖拽状态与行事件(源行标记、悬停目标高亮与指示线) */
  drag: ReturnType<typeof useTagDrag>;
}

export function TagRowList(p: TagRowListProps): ReactNode {
  /** 按显示序拉平可见行(树模式只含已展开的层级),便于在相邻行之间插入边界带 */
  const visible: TagNode[] = [];
  const walk = (nodes: TagNode[]): void => {
    for (const n of nodes) {
      visible.push(n);
      if (!p.flat && n.children.length > 0 && p.expanded(n.path)) walk(n.children);
    }
  };
  walk(p.nodes);

  const { dragging, sourcePath, clearDrag } = p.drag;
  useEffect(() => {
    if (dragging && sourcePath && !visible.some((n) => n.path === sourcePath)) clearDrag();
  });

  /** 边界带只提供命中区;插入线由 TagRow 自己画(整行 before/after),所以永远只有一条线 */
  const band = (prev: TagNode | null, next: TagNode | null, key: string): ReactNode => {
    const halves = bandHalves(prev, next);
    return (
      <TagDropBand
        key={key}
        upper={halves.upper}
        lower={halves.lower}
        active={p.drag.over}
        onDragOver={(e, s) => p.drag.bandEvents.onDragOverBand(e, s.path, s.zone)}
        onDrop={(e, s) => p.drag.bandEvents.onDropBand(e, s.path, s.zone)}
        onDragLeave={p.drag.bandEvents.onDragLeaveBand}
      />
    );
  };

  const last = visible[visible.length - 1];

  return (
    <>
      {visible.map((node, i) => (
        <Fragment key={node.path}>
          {dragging && band(visible[i - 1] ?? null, node, `band-${node.path}`)}
          <TagRow
            node={node}
            flat={p.flat}
            selected={p.selected.has(node.path)}
            excluded={p.excluded.has(node.path)}
            expanded={!p.flat && p.expanded(node.path)}
            onToggle={p.onToggle}
            onToggleExpand={p.onToggleExpand}
            onContextMenu={p.onContextMenu}
            dragSource={sourcePath === node.path}
            dragActive={dragging}
            dropZone={p.drag.over && p.drag.over.path === node.path ? p.drag.over.zone : null}
            onDragStart={(e) => p.drag.rowEvents.onDragStartRow(e, node)}
            onDragEnd={p.drag.rowEvents.onDragEnd}
            onDragOver={(e) => p.drag.rowEvents.onDragOverRow(e, node)}
            onDragLeave={p.drag.bandEvents.onDragLeaveBand}
            onDrop={(e) => p.drag.rowEvents.onDropRow(e, node)}
          />
        </Fragment>
      ))}
      {dragging && last && band(last, null, 'band-end')}
    </>
  );
}

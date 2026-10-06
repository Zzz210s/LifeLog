/**
 * 关系图视图外壳(2026-10-05 拆分:接线全部收进 `use-graph-view`):本文件只把接线给出的状态
 * 摆成 覆盖层 + 搜索 + 画布 + 气泡 + 信息条 + 标签菜单,并把容器上的指针/点击事件接上。
 */
import type { ReactNode } from 'react';
import { GraphCanvas } from './GraphCanvas';
import { GraphInfoBar } from './GraphInfoBar';
import { GraphOverlays } from './GraphOverlays';
import { GraphSearch } from './GraphSearch';
import { GraphTagMenuHost } from './GraphTagMenuHost';
import { GraphTip } from './GraphTip';
import { relationDegrees } from './graph-relations';
import { useGraphView, type GraphViewInput } from './use-graph-view';

export function GraphView(p: GraphViewInput): ReactNode {
  const {
    boxRef, size, themeKey, drag, acts, exp, resetView, count, empty, reload,
    filtersOpen, setFiltersOpen, force, filters, roots, patch, resetFilters,
    data, relations, nodes, onSearchPick, plan, hoveredNode, selectedNode, selected, expanded, setExpanded, menu, setMenu,
  } = useGraphView(p);

  return (
    <div
      ref={boxRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-app"
      data-testid="graph-view"
      onPointerDown={drag.onPointerDown}
      // 拖节点、拖空白平移、悬停命中各管一段:拖节点层先接手,没命中才轮到相机(见 use-node-drag)
      onPointerMove={(e) => {
        drag.onPointerMove(e);
        acts.onPointerMove(e);
      }}
      onPointerUp={drag.onPointerUp}
      onPointerLeave={(e) => {
        drag.onPointerLeave(e);
        acts.onPointerLeave();
      }}
      // 点在笔记小圆上就是「带着该标签回信息流」:不能再走画布点击(那会先把选中清掉)
      onClick={(e) => {
        if (!exp.onNoteClick(e)) acts.onClick(e);
      }}
      onDoubleClick={acts.onDoubleClick}
      onContextMenu={acts.onContextMenu}
    >
      <GraphOverlays
        count={count}
        empty={empty}
        open={filtersOpen}
        onToggle={() => setFiltersOpen((v) => !v)}
        onResetView={resetView}
        arranging={force.running}
        onArrange={force.start}
        filters={filters}
        roots={roots}
        onFilters={patch}
        onResetFilters={resetFilters}
      />
      <GraphSearch nodes={nodes} onPick={onSearchPick} />
      <GraphCanvas plan={plan} width={size.w} height={size.h} themeKey={themeKey} />
      <GraphTip node={hoveredNode} x={acts.tipAt?.x ?? 0} y={acts.tipAt?.y ?? 0} />
      {selectedNode !== null && (
        <GraphInfoBar
          node={selectedNode}
          relationDegrees={relationDegrees(relations, data?.nodes ?? [], selectedNode.id)}
          expanded={expanded === selected}
          onFilterToStream={() => p.onFilterToStream(selectedNode.path)}
          onToggleExpand={() => setExpanded((cur) => (cur === selected ? null : selected))}
        />
      )}
      <GraphTagMenuHost
        at={menu}
        allNodes={data?.nodes ?? []}
        tagMru={p.tagMru}
        onClose={() => setMenu(null)}
        onDone={() => {
          setMenu(null);
          reload(); // 改名/移动/合并/删除之后路径与计数都要重拉;相机与选中不动
        }}
      />
    </div>
  );
}

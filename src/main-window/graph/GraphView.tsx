/**
 * 关系图视图外壳:进视图拉一次图数据 -> 过滤/折叠(G3 起两者合一,见 useGraphFilters)->
 * 径向布局 -> 画布。数据进视图拉一次,标签数据版本变化时自动重拉(useGraphVersion);
 * 信息流与输入栏的启动路径不受影响(设计 §2.1)。
 *
 * 本文件只接线:`hovered` 在 useGraphInteractions,`selected`/`expanded` 在这里,相机在 useGraphCamera,
 * 拖节点与位置记忆在 useNodeDrag(松手写回落给相机的 `commitPositions`),容器上的首次适配与非被动
 * wheel 在 useGraphSurface,展开笔记在 useExpandedNotes,「一帧画什么」在 useGraphPlan,覆盖层
 * (工具栏/过滤器面板/空态)在 GraphOverlays,「整理布局」在 useForceLayout,数据版本重载在 useGraphVersion,
 * 命中对象与状态条文案在 graph-hints。「重置视图」与 `0` 的合成动作(回径向 + 复位相机)在 useGraphStage。
 * 口径提醒:`expanded`
 * 与 `selected` 各算各的 —— 点别的标签不会收掉已展开的小圆。
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GraphNode } from '../../shared/types';
import { GraphCanvas } from './GraphCanvas';
import { screenOf } from './graph-camera';
import { GraphInfoBar } from './GraphInfoBar';
import { GraphOverlays } from './GraphOverlays';
import { GraphSearch } from './GraphSearch';
import { GraphTagMenuHost } from './GraphTagMenuHost';
import { GraphTip } from './GraphTip';
import { graphHints, nodePath } from './graph-hints';
import { radialLayout, type Point } from './radial';
import { useCollapseRoots } from './use-collapse-roots';
import { useDprKey } from './use-dpr-key';
import { useEscapeExit } from './use-escape-exit';
import { useExpandedNotes } from './use-expanded-notes';
import { useGraphData } from './use-graph-data';
import { useGraphFilters } from './use-graph-filters';
import { useGraphInteractions } from './use-graph-interactions';
import { useGraphOrigin } from './use-graph-origin';
import { useGraphPlan } from './use-graph-plan';
import { useGraphSize } from './use-graph-size';
import { useGraphStage } from './use-graph-stage';
import { useGraphVersion } from './use-graph-version';
import { useAutoFit, usePassiveWheel } from './use-graph-surface';
import { useThemeKey } from './use-theme-key';

const LAYER_GAP = 90;

export function GraphView(p: {
  onExit: () => void;
  /** 「筛到信息流」:上层采纳这个标签(与侧栏点标签同一口径)并切回信息流 */
  onFilterToStream: (path: string) => void;
  /** 标签数据版本(App 的 `tagsVersion`):变了就重取图数据,相机 / 选中 / 展开都保留 */
  dataVersion: number;
}): ReactNode {
  const { data, failed, reload } = useGraphData();
  // 数据变化自动重载(设计 §6-5):版本不变不动;`reload` 只换 data
  useGraphVersion(p.dataVersion, reload);
  const [selected, setSelected] = useState<number | null>(null);
  // 展开态:信息条文案与笔记小圆都吃它(双击展开/收起也改它);与 selected 各算各的
  const [expanded, setExpanded] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false); // 纯 UI 状态,不进 settings
  const themeKey = useThemeKey();
  const dprKey = useDprKey();
  const boxRef = useRef<HTMLDivElement>(null);
  // 容器实测尺寸:窗口 resize / DPR 变化都要重建几何(设计 §6-3)与后备缓冲
  const size = useGraphSize(boxRef);

  // 折叠根从设置派生(`null` = 还没读到);调用位置不能挪到 useGraphCamera 之后(两处都读 getSetting,顺序被用例钉住)。
  const collapsedRoots = useCollapseRoots();

  const { nodes, edges, links, empty, filters, roots, patch, reset: resetFilters } = useGraphFilters(data, collapsedRoots);
  const layout: Map<number, Point> = useMemo(() => radialLayout(nodes, { layerGap: LAYER_GAP }), [nodes]);
  // 位置记忆的修剪口径:库里的**全部**标签(不是过滤后的可见集)—— 被过滤器藏起来的标签,位置要留着
  const validIds = useMemo(() => new Set((data?.nodes ?? []).map((n) => n.id)), [data]);

  // 容器原点(视口坐标 <-> 画布坐标的换算基准):相机缩放锚点、交互命中、气泡锚点共读一份
  const origin = useGraphOrigin(boxRef);

  // 落点层(整理 -> 相机 -> 拖节点 -> 力导向)收在 useGraphStage:顺序固定,也是它守本文件的行数
  // `resetView` 是「重置视图」与 `0` 共用的出口(整理结果回径向 + 相机复位)
  const { cam, drag, force, points, resetView } = useGraphStage({ layout, nodes, edges, origin, validIds, size });
  // 首次适配一次(设计 §3.3):落点、尺寸、折叠根都就绪才动相机 —— 折叠根异步读设置,不等它就会拿「没折叠」的全量落点算 fit(退出再进图实测 k=0.751/411/304.2,折叠后应为 0.949/547.1/221.9);此后只由 `0` 复位;wheel 必须显式非被动层
  useAutoFit(layout.size > 0 && size.w > 0 && collapsedRoots !== null, cam.reset);
  usePassiveWheel(boxRef, cam.onWheel);

  // 展开笔记:吃 `expanded` 而不是 selected —— 点了别的标签,已展开的那圈小圆还要在。
  // 展开层(小圆 + `+N`)由 useExpandedNotes 产出且**身份稳定**:plan 的 memo 与 `+N` 命中共读这一份
  const expandedNode = expanded === null ? null : (nodes.find((n) => n.id === expanded) ?? null);
  const exp = useExpandedNotes({
    node: expandedNode,
    points,
    cam: cam.camera,
    origin,
    onFilterToStream: p.onFilterToStream,
  });

  const acts = useGraphInteractions({
    nodes,
    points,
    cam: cam.camera,
    origin,
    onSelect: setSelected,
    // 点聚合圆 = 放大到该处(设计 D3):以那个圆**自己的屏幕位置**为锚点放大一档。
    // 先 centerOn 再 zoomBy 也能看,但锚点会落在画布中心 —— 用户点的是圆,就该围着圆放大。
    onZoomIn: (id) => {
      const at = points.get(id);
      if (!at) return;
      cam.zoomAtScreen(screenOf(at, cam.camera), 1.8);
    },
    onExpand: (id) => setExpanded((cur) => (cur === id ? null : id)),
    onMenu: (id, x, y) => setMenu({ id, x, y }),
    // `+N` 画在环外偏下:单击优先判它 = 带着该标签回信息流(与点笔记小圆同一口径)
    overflow: exp.layer?.overflow ?? null,
    onOverflow: (id) => { const path = nodePath(nodes, id); if (path !== null) p.onFilterToStream(path); },
    // 双击空白 = 回信息流(设计 §5)
    onExit: p.onExit,
  });

  // 图内搜索跳转(G2 Task 7):把相机挪到该节点(**不改缩放**)并选中 —— 信息条随之出现
  const onSearchPick = (node: GraphNode): void => {
    const at = points.get(node.id);
    if (at !== undefined) cam.centerOn(at);
    setSelected(node.id);
  };

  // 一帧画什么(含强调态)在 useGraphPlan:本文件只把视图状态摆好递进去
  const plan = useGraphPlan({
    nodes,
    edges,
    links,
    points,
    cam: cam.camera,
    size,
    themeKey,
    dprKey,
    selected,
    hovered: acts.hovered,
    // 展开层给的是屏幕坐标(见 useExpandedNotes);展开者被裁到视口外时 drawPlan 整组不画
    expanded: exp.layer,
  });

  // 命中对象与状态条文案是纯派生(graphHints);本文件只摆状态
  const { selectedNode, hoveredNode, count } = graphHints({
    nodes, edges, selected, hovered: acts.hovered, failed, expandedNotes: exp,
  });

  // Esc:有选中就把该标签带回信息流,没选中则原样退出(设计 §5);注册口径见 use-escape-exit
  useEscapeExit({
    selectedPath: selectedNode === null ? null : selectedNode.path,
    onExit: p.onExit,
    onFilterToStream: p.onFilterToStream,
  });

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
          expanded={expanded === selected}
          onFilterToStream={() => p.onFilterToStream(selectedNode.path)}
          onToggleExpand={() => setExpanded((cur) => (cur === selected ? null : selected))}
        />
      )}
      <GraphTagMenuHost
        at={menu}
        allNodes={data?.nodes ?? []}
        onClose={() => setMenu(null)}
        onDone={() => {
          setMenu(null);
          reload(); // 改名/移动/合并/删除之后路径与计数都要重拉;相机与选中不动
        }}
      />
    </div>
  );
}

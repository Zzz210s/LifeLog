/**
 * 关系图视图外壳:进视图拉一次图数据 -> 过滤/折叠(G3 起两者合一,见 useGraphFilters)->
 * 径向布局 -> 画布。数据只在进视图时拉取,信息流与输入栏的启动路径不受影响(设计 §2.1)。
 *
 * 本文件只接线:`hovered` 在 useGraphInteractions,`selected`/`expanded` 在这里,相机在 useGraphCamera,
 * 展开笔记在 useExpandedNotes,「一帧画什么」在 useGraphPlan,覆盖层(工具栏/过滤器面板/空态)
 * 在 GraphOverlays。口径提醒:`expanded` 与 `selected` 各算各的 —— 点别的标签不会收掉已展开的小圆。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GraphNode } from '../../shared/types';
import { GraphCanvas } from './GraphCanvas';
import { GraphInfoBar } from './GraphInfoBar';
import { GraphOverlays } from './GraphOverlays';
import { GraphSearch } from './GraphSearch';
import { GraphTagMenuHost } from './GraphTagMenuHost';
import { GraphTip } from './GraphTip';
import { radialLayout, type Point } from './radial';
import { useCollapseRoots } from './use-collapse-roots';
import { useDprKey } from './use-dpr-key';
import { useEscapeExit } from './use-escape-exit';
import { useExpandedNotes } from './use-expanded-notes';
import { useGraphCamera } from './use-graph-camera';
import { useGraphData } from './use-graph-data';
import { useGraphFilters } from './use-graph-filters';
import { useGraphInteractions } from './use-graph-interactions';
import { useGraphOrigin } from './use-graph-origin';
import { useGraphPlan } from './use-graph-plan';
import { useGraphSize } from './use-graph-size';
import { useThemeKey } from './use-theme-key';

const LAYER_GAP = 90;

export function GraphView(p: {
  onExit: () => void;
  /** 「筛到信息流」:上层采纳这个标签(与侧栏点标签同一口径)并切回信息流 */
  onFilterToStream: (path: string) => void;
}): ReactNode {
  const { data, failed, reload } = useGraphData();
  const [selected, setSelected] = useState<number | null>(null);
  // 展开态:信息条的按钮文案与 Task 6 的笔记小圆都吃它(双击展开/收起也改它)
  // 展开态:信息条文案与笔记小圆都吃它(双击展开/收起也改它);与 selected 各算各的
  const [expanded, setExpanded] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false); // 纯 UI 状态,不进 settings
  const themeKey = useThemeKey();
  const dprKey = useDprKey();
  const fitted = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // 容器实测尺寸:窗口 resize / DPR 变化都要重建几何(设计 §6-3)与后备缓冲
  const size = useGraphSize(boxRef);

  // 折叠根从设置派生;调用位置不能挪到 useGraphCamera 之后(两处都读 getSetting,顺序被用例钉住)。
  const collapsedRoots = useCollapseRoots();

  const { nodes, edges, empty, filters, roots, patch, reset: resetFilters } = useGraphFilters(data, collapsedRoots);
  const layout: Map<number, Point> = useMemo(() => radialLayout(nodes, { layerGap: LAYER_GAP }), [nodes]);
  const selectedNode = selected === null ? null : (nodes.find((n) => n.id === selected) ?? null);

  // 容器原点(视口坐标 <-> 画布坐标的换算基准):相机缩放锚点、交互命中、气泡锚点共读一份
  const origin = useGraphOrigin(boxRef);

  // Esc:有选中就把该标签带回信息流,没选中则原样退出(设计 §5);注册口径见 use-escape-exit
  useEscapeExit({
    selectedPath: selectedNode === null ? null : selectedNode.path,
    onExit: p.onExit,
    onFilterToStream: p.onFilterToStream,
  });

  const cam = useGraphCamera({ width: size.w, height: size.h, points: layout, origin });
  // 画布的 wheel 必须显式 passive: false,只能走 addEventListener(React 的 onWheel 挂在被动层)
  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    el.addEventListener('wheel', cam.onWheel, { passive: false });
    return () => el.removeEventListener('wheel', cam.onWheel);
  }, [cam.onWheel]);

  const acts = useGraphInteractions({
    nodes,
    points: cam.points,
    cam: cam.camera,
    origin,
    onSelect: setSelected,
    onExpand: (id) => setExpanded((cur) => (cur === id ? null : id)),
    onMenu: (id, x, y) => setMenu({ id, x, y }),
    // 双击空白 = 回信息流(设计 §5)
    onExit: p.onExit,
  });

  // 展开笔记:吃 `expanded` 而不是 selected —— 点了别的标签,已展开的那圈小圆还要在
  const expandedNode = expanded === null ? null : (nodes.find((n) => n.id === expanded) ?? null);
  const exp = useExpandedNotes({
    node: expandedNode,
    points: cam.points,
    cam: cam.camera,
    origin,
    onFilterToStream: p.onFilterToStream,
  });

  // 展开层要身份稳定:每次渲染新建对象会让 plan 的 memo 白重建(依赖理由见 use-graph-plan)
  const expandedLayer = useMemo(
    () => (expanded === null ? null : { id: expanded, dots: exp.dots, overflow: exp.overflow }),
    [expanded, exp.dots, exp.overflow],
  );

  // 图内搜索跳转(G2 Task 7):把相机挪到该节点(**不改缩放**)并选中 —— 信息条随之出现,
  // 「搜到 -> 看到详情」一步到位;节点在布局里缺席时(环/自指落不了位)只选中,不做定点
  const onSearchPick = (node: GraphNode): void => {
    const at = cam.points.get(node.id);
    if (at !== undefined) cam.centerOn(at);
    setSelected(node.id);
  };

  // 首次适配视图(设计 §3.3);此后不再自动改相机 —— 用户按 0 才复位(Task 6)。
  // 复位路径与 `0` 键共用 cam.reset,避免"定点适配"出现两份实现。
  const reset = cam.reset;
  useEffect(() => {
    if (fitted.current || layout.size === 0 || size.w === 0) return;
    fitted.current = true;
    reset();
  }, [layout, size, reset]);

  // 一帧画什么(含强调态)在 useGraphPlan:本文件只把视图状态摆好递进去
  const plan = useGraphPlan({
    nodes,
    edges,
    points: cam.points,
    cam: cam.camera,
    size,
    themeKey,
    dprKey,
    selected,
    hovered: acts.hovered,
    // 展开层给的是世界坐标(见 useExpandedNotes);展开者被裁到视口外时 drawPlan 整组不画
    expanded: expandedLayer,
  });

  const hoveredNode = acts.hovered === null ? null : (nodes.find((n) => n.id === acts.hovered) ?? null);
  // 展开笔记的状态优先占状态条文案位(用户当下最关心的那件事);没在展开就跟原来一样报计数
  const noteHint = exp.failed ? '笔记加载失败' : exp.loading ? '正在展开笔记…' : null;
  const count = noteHint ?? (failed ? '关系图加载失败' : `${nodes.length} 个节点 / ${edges.length} 条边`);

  return (
    <div
      ref={boxRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-app"
      data-testid="graph-view"
      onPointerDown={cam.onPointerDown}
      // 拖空白平移(相机)与悬停命中(交互)各管一半,两条都要挂 —— Task 5 只留了悬停那条,拖空白处整个图不动
      onPointerMove={(e) => {
        cam.onPointerMove(e);
        acts.onPointerMove(e);
      }}
      onPointerUp={cam.onPointerUp}
      onPointerLeave={() => {
        cam.onPointerUp();
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
        onResetView={cam.reset}
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

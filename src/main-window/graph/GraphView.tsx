/**
 * 关系图视图外壳(G1):打开时拉一次图数据 -> 折叠时间轴 -> 径向布局 -> 画布。
 * 数据只在进入本视图时拉取,信息流与输入栏的启动路径不受影响(设计 §2.1)。
 * 画布尺寸按容器实测:窗口 resize / DPR 变化都要重建几何(设计 §6-3),
 * 故 `plan` 的 memo 依赖必须含 `size`(尺寸变而 plan 未变 -> 位图被拉伸,Task 4 审查交接)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import type { GraphData } from '../../shared/types';
import { GraphCanvas } from './GraphCanvas';
import { fitToView } from './graph-camera';
import { drawPlan, type DrawPlan } from './graph-draw-plan';
import { visibleGraph } from './graph-view-model';
import { radialLayout, type Point } from './radial';
import { token } from './token';
import { useThemeKey } from './use-theme-key';

const DEFAULT_COLLAPSED = ['时间']; // 设计 D8:时间轴默认折叠
const LAYER_GAP = 90;

const EMPTY_PLAN: DrawPlan = { co: [], tree: [], dots: [], labels: [] };

export function GraphView(p: { onExit: () => void }): ReactNode {
  const [data, setData] = useState<GraphData | null>(null);
  const [failed, setFailed] = useState(false);
  const [camera, setCamera] = useState({ k: 1, tx: 0, ty: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const themeKey = useThemeKey();
  const fitted = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 尺寸按容器实测:CSS 像素取整(亚像素宽高会让后备缓冲出现半像素模糊)
  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const measure = (): void => {
      const dpr = window.devicePixelRatio || 1;
      setSize({ w: Math.round(el.clientWidth * dpr) / dpr, h: Math.round(el.clientHeight * dpr) / dpr });
    };
    measure();
    // jsdom 没有 ResizeObserver:没有它时只靠上面的首次测量与 window resize
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // 数据只在进视图时拉一次(G1 无重载:库变更后重新进视图即可)
  useEffect(() => {
    let alive = true;
    void api.graphData().then(
      (d) => {
        if (alive) setData(d);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') p.onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  const { nodes, edges } = useMemo(
    () => (data === null ? { nodes: [], edges: [] } : visibleGraph(data, { collapsedRoots: DEFAULT_COLLAPSED })),
    [data],
  );
  const points: Map<number, Point> = useMemo(() => radialLayout(nodes, { layerGap: LAYER_GAP }), [nodes]);

  // 首次适配视图(设计 §3.3);此后不再自动改相机,除非用户按 0 复位(Task 6)
  useEffect(() => {
    if (fitted.current || points.size === 0 || size.w === 0) return;
    fitted.current = true;
    setCamera(fitToView([...points.values()], size.w, size.h));
  }, [points, size]);

  const plan = useMemo(
    () =>
      size.w === 0 || size.h === 0
        ? EMPTY_PLAN
        : drawPlan({
            nodes,
            edges,
            points,
            cam: camera,
            w: size.w,
            h: size.h,
            rootColor: new Map<number, string>(), // G1 不按根着色:统一用主题令牌兜底色
            fallbackColor: token('--color-muted'),
          }),
    // themeKey 进依赖:兜底色是计划期读的令牌,换主题必须重建 plan(边/文字的颜色在画布里现读)
    [nodes, edges, points, camera, size, themeKey],
  );

  const count = failed ? '关系图加载失败' : `${nodes.length} 个节点 / ${edges.length} 条边`;

  return (
    <div ref={boxRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-app" data-testid="graph-view">
      <div
        role="status"
        className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-border bg-raised px-2 py-1 text-xs text-muted"
      >
        {count}
      </div>
      <GraphCanvas plan={plan} width={size.w} height={size.h} themeKey={themeKey} />
    </div>
  );
}

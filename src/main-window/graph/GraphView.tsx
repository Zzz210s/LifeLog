/**
 * 关系图视图外壳(G1):打开时拉一次图数据 -> 折叠时间轴根 -> 径向布局 -> 画布。
 * 折叠哪一根从设置 `time_tag_template` 派生(G2;`collapseRootsOf`),读到之前不折叠。
 * 数据只在进入本视图时拉取,信息流与输入栏的启动路径不受影响(设计 §2.1)。
 * 画布尺寸按容器实测:窗口 resize / DPR 变化都要重建几何(设计 §6-3),
 * 故 `plan` 的 memo 依赖必须含 `size` 与 `dprKey`(尺寸变而 plan 未变 -> 位图被拉伸,Task 4 审查交接;
 * 纯 DPR 变化时尺寸量化可能量不出差别,只靠 size 会停在旧 DPR)。
 * 相机(缩放/平移/`+` `-` `0`/位置记忆)全在 useGraphCamera;这里只负责把 DOM 事件接上去。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import type { GraphData } from '../../shared/types';
import { GraphCanvas } from './GraphCanvas';
import { drawPlan, type DrawPlan } from './graph-draw-plan';
import { NO_EMPHASIS } from './graph-focus';
import { collapseRootsOf, visibleGraph } from './graph-view-model';
import { radialLayout, type Point } from './radial';
import { token } from './token';
import { useDprKey } from './use-dpr-key';
import { useGraphCamera } from './use-graph-camera';
import { useThemeKey } from './use-theme-key';
import { normalizeTemplate, TIME_TAG_TEMPLATE_KEY } from '../settings/time-tag-settings';

const LAYER_GAP = 90;

const EMPTY_PLAN: DrawPlan = { co: [], tree: [], dots: [], labels: [], notes: [], overflow: null };

export function GraphView(p: { onExit: () => void }): ReactNode {
  const [data, setData] = useState<GraphData | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const themeKey = useThemeKey();
  const dprKey = useDprKey();
  const fitted = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 尺寸按容器实测:CSS 像素取整(亚像素宽高会让后备缓冲出现半像素模糊)。
  // 读数没变就不换对象:拖窗口会连发 resize,白换一次会让 plan 重建、整图重绘。
  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const measure = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(el.clientWidth * dpr) / dpr;
      const h = Math.round(el.clientHeight * dpr) / dpr;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
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

  // 数据只在进视图时拉一次(G1 无重载:库变更后重新进视图即可);迟到/卸载后的回包一律不碰状态
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

  // Esc 只依赖回调本身(App 传的 backToStream 是 useCallback(..., []),身份恒定):props 对象只在
  // 父组件重渲染时换身份,依赖 [p] 会让视图开着时每次 App 重渲染都摘掉再挂一次 window 监听
  // (真机实测:切一次侧栏就多挂 1 次;平移不会,与上面 cam.onWheel 的口径一致)。
  const onExit = p.onExit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  // 折叠根从设置派生(G2 收 G1 欠账:写死 `'时间'` 会让用户改根名后折叠静默失效)。
  // 读到之前 tpl 是 null(= 不折叠),回包一到 useMemo 依赖变化自然重算。
  const [tpl, setTpl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getSetting(TIME_TAG_TEMPLATE_KEY).then(
      (t) => {
        if (alive) setTpl(normalizeTemplate(t));
      },
      () => {
        /* 读不到设置就保持不折叠(后端默认值与库内根名对得上时才有得折),不把整图判成加载失败 */
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  const collapsedRoots = useMemo(() => collapseRootsOf(tpl), [tpl]);

  const { nodes, edges } = useMemo(
    () => (data === null ? { nodes: [], edges: [] } : visibleGraph(data, { collapsedRoots })),
    [data, collapsedRoots],
  );
  const layout: Map<number, Point> = useMemo(() => radialLayout(nodes, { layerGap: LAYER_GAP }), [nodes]);

  const cam = useGraphCamera({ width: size.w, height: size.h, points: layout });
  // 画布的 wheel 必须显式 passive: false,只能走 addEventListener(React 的 onWheel 挂在被动层)
  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    el.addEventListener('wheel', cam.onWheel, { passive: false });
    return () => el.removeEventListener('wheel', cam.onWheel);
  }, [cam.onWheel]);

  // 首次适配视图(设计 §3.3);此后不再自动改相机 —— 用户按 0 才复位(Task 6)。
  // 复位路径与 `0` 键共用 cam.reset,避免"定点适配"出现两份实现。
  const reset = cam.reset;
  useEffect(() => {
    if (fitted.current || layout.size === 0 || size.w === 0) return;
    fitted.current = true;
    reset();
  }, [layout, size, reset]);

  const points = cam.points;
  const plan = useMemo(
    () =>
      size.w === 0 || size.h === 0
        ? EMPTY_PLAN
        : drawPlan({
            nodes,
            edges,
            points,
            cam: cam.camera,
            w: size.w,
            h: size.h,
            rootColor: new Map<number, string>(), // G1 不按根着色:统一用主题令牌兜底色
            fallbackColor: token('--color-muted'),
            // 强调态由交互层给(Task 5);接线之前是「无焦点」,谁都不弱化
            emphasis: NO_EMPHASIS,
          }),
    // themeKey 进依赖:兜底色是计划期读的令牌,换主题必须重建 plan(边/文字的颜色在画布里现读)
    // dprKey 进依赖:纯 DPR 变化时尺寸可能一点没变,不重建 plan 就不会重设后备缓冲(画布停在旧 DPR)
    [nodes, edges, points, cam.camera, size, themeKey, dprKey],
  );

  const count = failed ? '关系图加载失败' : `${nodes.length} 个节点 / ${edges.length} 条边`;

  return (
    <div
      ref={boxRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-app"
      data-testid="graph-view"
      onPointerDown={cam.onPointerDown}
      onPointerMove={cam.onPointerMove}
      onPointerUp={cam.onPointerUp}
      onPointerLeave={cam.onPointerUp}
    >
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

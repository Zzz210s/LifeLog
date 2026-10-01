/**
 * 「整理布局」的两件事(G3 Task 4):
 * - `useArrangedLayout` —— 视图侧的整理结果状态(力导向算出来的坐标)
 * - `useForceLayout` —— 分块调度(rAF 逐帧跑 `runFrame`,每帧 ≤ FRAME_BUDGET_MS,收敛 / 超时停手)
 *
 * 一帧的步进在 `force-frame.ts`(纯函数,好断言预算);一步的力在 `force-layout.ts`。
 *
 * **整理结果不写库**:`graph_positions` 只由拖节点写(`useNodeDrag` → `cam.commitPositions`)。
 * 设计 §3.4 说"力导向只改内存中的坐标",理由不只是省一次 IPC:整理是"换个摊法看一眼"的探索动作,
 * 若也落库,用户点一下按钮就永久覆盖自己摆好的位置,而且没有撤销入口 —— 退出视图回到径向布局才是可逆的。
 *
 * `useArrangedLayout` 还负责"布局换代即作废":过滤器 / 折叠换了节点集,径向布局会重建,
 * 旧的整理坐标对不上新节点集(多出的、缺掉的 id 全错),必须丢弃而不是硬套。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphEdge } from '../../shared/types';
import { FRAME_BUDGET_MS, MAX_TOTAL_MS, runFrame } from './force-frame';
import type { Point } from './radial';

export interface ForceLayoutApi {
  running: boolean;
  start: () => void;
  stop: () => void;
}

export function useForceLayout(input: {
  /** 整理起点(当前可见落点,含位置记忆)—— 只在 start() 时快照一次 */
  points: Map<number, Point>;
  edges: readonly GraphEdge[];
  /** 锚点:被拖过的节点(位置记忆里有),力导向不动它们 */
  anchors: ReadonlySet<number>;
  /** 每帧的中间结果(含停手的那一帧) */
  onFrame: (points: Map<number, Point>) => void;
  budgetMs?: number;
}): ForceLayoutApi {
  const [running, setRunning] = useState(false);
  // "最新入参"ref:跑动中边 / 锚点 / 回调都可能随渲染变,而循环本身只在 start() 时建一次
  const latest = useRef(input);
  latest.current = input;
  const raf = useRef<number | null>(null);

  const stop = useCallback((): void => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setRunning(false);
  }, []);

  const start = useCallback((): void => {
    if (raf.current !== null) return; // 已经在整理
    const { edges, anchors, onFrame } = latest.current;
    const budgetMs = latest.current.budgetMs ?? FRAME_BUDGET_MS;
    if (latest.current.points.size === 0) return;
    // 起点快照一次:整理结果每帧会经相机回灌回 `points` prop,回灌不能污染正在跑的这一步
    let cur = new Map(latest.current.points);
    let alpha = 1;
    let total = 0;
    let last = performance.now();
    setRunning(true);

    const frame = (): void => {
      raf.current = null;
      const at = performance.now();
      total += at - last;
      last = at;
      const r = runFrame({ points: cur, edges, anchors, alpha, now: () => performance.now(), budgetMs });
      cur = r.points;
      alpha = r.alpha;
      onFrame(cur);
      if (r.converged || total > MAX_TOTAL_MS) {
        setRunning(false);
        return;
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  }, []);

  // 卸载:撤掉待跑的帧(不再回调,也不会 setState 到已卸载的组件上)
  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    },
    [],
  );

  return { running, start, stop };
}

export interface ArrangedLayout {
  /** 整理后的坐标;没整理过(或布局换代作废后)就是径向布局本身(引用不变,下游 memo 不白重建) */
  points: Map<number, Point>;
  /** 把整理结果交进来(每帧一次) */
  setPoints: (points: Map<number, Point>) => void;
}

/** 整理结果的状态 + "布局换代即作废"(见文件头) */
export function useArrangedLayout(layout: Map<number, Point>): ArrangedLayout {
  const [arranged, setArranged] = useState<{ from: Map<number, Point>; points: Map<number, Point> } | null>(null);
  const setPoints = useCallback((points: Map<number, Point>) => setArranged({ from: layout, points }), [layout]);
  const points = arranged !== null && arranged.from === layout ? arranged.points : layout;
  return { points, setPoints };
}

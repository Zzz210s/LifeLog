/**
 * 过滤器的状态与派生(G3):默认值、数据重载后的轴集合漂移、过滤结果。
 *
 * 轴集合漂移:数据重载(改名/新建/删除标签)后根集合可能变。判据是「**本次重载才出现的根**」,
 * 不是「当前不在 axes 里的根」—— 后者会把用户刚取消勾选的轴当成新出现的根又加回 axes
 * (G3 真机读数 1 抓到的缺陷:取消勾选任何未折叠的轴都完全无效)。
 * 「已经见过的根」记在 `seen` 里(只增不减),新根默认展开(它本身是折叠根时保持收起)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData } from '../../shared/types';
import { applyFilters, axisOptions, defaultFilters, type GraphFilters } from './graph-filters';

/** 折叠根还没读到时按「不折叠」算:轴漂移与相机适配各有各的就绪信号(后者见 GraphView 的 useAutoFit) */
const NO_COLLAPSE: readonly string[] = [];

export function useGraphFilters(data: GraphData | null, collapsedRoots: readonly string[] | null) {
  const roots = useMemo(() => (data === null ? [] : axisOptions(data)), [data]);
  const collapsed = collapsedRoots ?? NO_COLLAPSE;
  const [edited, setEdited] = useState<GraphFilters | null>(null);
  /** 出现过的根(只增不减):用户取消勾选的轴从此不再被当成「新出现的根」 */
  const seen = useRef<Set<string>>(new Set());

  const filters = useMemo((): GraphFilters => {
    if (edited === null) return defaultFilters(roots, collapsed);
    const known = new Set(roots);
    const kept = edited.axes.filter((a) => known.has(a));
    const appeared = roots.filter((r) => !seen.current.has(r) && !collapsed.includes(r));
    return { ...edited, axes: [...kept, ...appeared] };
  }, [edited, roots, collapsed]);

  // 新出现的根:先记进 `seen`(只增不减)。编辑态还要把它落进 `edited` —— 渲染期的 `appeared` 只是
  // 当帧可见,不落 edited 的话下一轮 `seen` 命中又把它从 axes 里丢掉;而只落 edited 不记 seen,
  // 用户取消勾选后同一个判据会立刻把它加回来 —— 两件事必须一起做。
  // 未编辑态由 `defaultFilters` 现算,不需回填,但根集合同样要进 `seen`(否则第一次取消勾选时全被当新根)。
  useEffect(() => {
    const fresh = roots.filter((r) => !seen.current.has(r));
    if (fresh.length === 0) return;
    for (const r of fresh) seen.current.add(r);
    if (edited === null) return;
    setEdited((e) => {
      if (e === null) return e;
      const add = fresh.filter((r) => !collapsed.includes(r) && !e.axes.includes(r));
      return add.length === 0 ? e : { ...e, axes: [...e.axes, ...add] };
    });
  }, [roots, collapsed, edited]);

  const view = useMemo(
    () =>
      data === null
        ? { nodes: [], edges: [], links: [], empty: false }
        : applyFilters(data, filters),
    [data, filters],
  );

  return {
    filters,
    roots,
    ...view,
    patch: (f: GraphFilters): void => setEdited(f),
    reset: (): void => setEdited(null),
  };
}

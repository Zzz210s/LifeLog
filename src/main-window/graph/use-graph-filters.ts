/**
 * 过滤器的状态与派生(G3):默认值、数据重载后的轴集合漂移、过滤结果。
 *
 * 轴集合漂移的处理:数据重载(改名/新建/删除标签)后根集合可能变 —— 仍在的轴保持勾选状态,
 * 新出现的根按"是否属于折叠根"决定(不折叠的默认展开,折叠的默认收起)。
 */
import { useMemo, useState } from 'react';
import type { GraphData } from '../../shared/types';
import { applyFilters, axisOptions, defaultFilters, type GraphFilters } from './graph-filters';

export function useGraphFilters(data: GraphData | null, collapsedRoots: readonly string[]) {
  const roots = useMemo(() => (data === null ? [] : axisOptions(data)), [data]);
  const [edited, setEdited] = useState<GraphFilters | null>(null);

  const filters = useMemo((): GraphFilters => {
    if (edited === null) return defaultFilters(roots, collapsedRoots);
    const known = new Set(roots);
    const kept = edited.axes.filter((a) => known.has(a));
    const appeared = roots.filter(
      (r) => !edited.axes.includes(r) && !collapsedRoots.includes(r),
    );
    return { ...edited, axes: [...kept, ...appeared] };
  }, [edited, roots, collapsedRoots]);

  const view = useMemo(
    () => (data === null ? { nodes: [], edges: [], empty: false } : applyFilters(data, filters)),
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

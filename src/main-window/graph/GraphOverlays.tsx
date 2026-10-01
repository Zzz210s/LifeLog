/**
 * 图上的覆盖层集合(G3):工具栏(状态/过滤器/重置视图)+ 过滤器面板 + 空态提示。
 *
 * 抽出来是为了让 `GraphView` 只留一行 JSX(它已经贴着 200 行红线),接线本身没逻辑。
 */
import type { ReactNode } from 'react';
import { GraphEmpty } from './GraphEmpty';
import { GraphFilterPanel } from './GraphFilterPanel';
import { GraphToolbar } from './GraphToolbar';
import type { GraphFilters } from './graph-filters';

export function GraphOverlays(p: {
  count: string;
  empty: boolean;
  open: boolean;
  onToggle: () => void;
  onResetView: () => void;
  filters: GraphFilters;
  roots: readonly string[];
  onFilters: (f: GraphFilters) => void;
  onResetFilters: () => void;
}): ReactNode {
  return (
    <>
      <GraphToolbar
        count={p.count}
        filtersOpen={p.open}
        onToggleFilters={p.onToggle}
        onResetView={p.onResetView}
      />
      {p.open && (
        <GraphFilterPanel
          filters={p.filters}
          roots={p.roots}
          onChange={p.onFilters}
          onReset={p.onResetFilters}
        />
      )}
      {p.empty && <GraphEmpty onReset={p.onResetFilters} />}
    </>
  );
}

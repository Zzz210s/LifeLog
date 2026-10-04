/**
 * 四项过滤器面板(G3,设计 §2.3):轴(勾选 = 展开该轴)/ 深度上限 / 只显示有笔记的标签 / 最少笔记数。
 *
 * 受控组件:状态在 `useGraphFilters`,这里只收集参数。「取消勾选某轴」= 折叠它(只留根节点),
 * 口径见 graph-filters.ts 的文件头。
 */
import type { ReactNode } from 'react';
import { BTN_SECONDARY } from '../shell/button-classes';
import { MAX_DEPTH_LIMIT, MIN_NOTES_CHOICES, type GraphFilters } from './graph-filters';

// V4 文本控件口径:32 高 + 6 圆角 + 强边 + --text-ui(门禁 v4-control-scan 会检查)
const SELECT = 'h-8 rounded-sm border border-border-strong bg-raised px-2 text-ui text-muted outline-none';
const ROW = 'mb-1.5 flex items-center justify-between gap-2';

export function GraphFilterPanel(p: {
  filters: GraphFilters;
  roots: readonly string[];
  onChange: (f: GraphFilters) => void;
  onReset: () => void;
}): ReactNode {
  const toggleAxis = (root: string): void => {
    const on = p.filters.axes.includes(root);
    p.onChange({
      ...p.filters,
      axes: on ? p.filters.axes.filter((x) => x !== root) : [...p.filters.axes, root],
    });
  };
  return (
    <div
      data-testid="graph-filters"
      className="absolute left-3 top-14 z-20 w-64 rounded-md border border-border bg-raised p-2 text-label shadow-lg"
    >
      <div className="mb-1 text-muted">展开的轴(取消 = 折叠成根节点)</div>
      <div className="mb-2 max-h-48 overflow-auto">
        {p.roots.map((root) => (
          <label key={root} className="flex cursor-pointer items-center gap-1.5 py-0.5">
            <input
              type="checkbox"
              checked={p.filters.axes.includes(root)}
              onChange={() => toggleAxis(root)}
              aria-label={`展开轴 ${root}`}
            />
            <span className="truncate">{root}</span>
          </label>
        ))}
      </div>
      <label className={ROW}>
        <span className="text-muted">深度上限</span>
        <select
          className={SELECT}
          aria-label="深度上限"
          value={p.filters.maxDepth}
          onChange={(e) => p.onChange({ ...p.filters, maxDepth: Number(e.target.value) })}
        >
          {Array.from({ length: MAX_DEPTH_LIMIT }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className={ROW}>
        <span className="text-muted">只显示有笔记的标签</span>
        <input
          type="checkbox"
          checked={p.filters.onlyWithNotes}
          aria-label="只显示有笔记的标签"
          onChange={(e) => p.onChange({ ...p.filters, onlyWithNotes: e.target.checked })}
        />
      </label>
      <label className={ROW}>
        <span className="text-muted">最少笔记数</span>
        <select
          className={SELECT}
          aria-label="最少笔记数"
          value={p.filters.minNotes}
          onChange={(e) => p.onChange({ ...p.filters, minNotes: Number(e.target.value) })}
        >
          {MIN_NOTES_CHOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={`mt-1 w-full ${BTN_SECONDARY}`}
        onClick={p.onReset}
      >
        重置过滤器
      </button>
    </div>
  );
}

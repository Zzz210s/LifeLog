/**
 * 排序面板(设计 2026-10-06 §4.5/§4.7):替代「最新/最早」两个写死按钮。
 * 列表每行:勾选框(enabled)+ 维度/轴名 + 方向(文案随维度变)+ 上移/下移 + 移除;
 * 底部「+ 排序条件」-> 选维度(时间 / 标签轴 -> 标签选择器)。
 * 写库只走 `sorts`(onPatch({ sorts })),旧 `sort` 仅由 filter-state 落态时派生镜像。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MAX_SORT_CONDS } from '../../shared/filter-conditions';
import type { FilterConditions, SortCond, SortDir } from '../../shared/filter-conditions';
import { TagPickDialog } from './TagPickDialog';
import {
  addSort,
  dirLabel,
  hasSortAxis,
  moveSort,
  removeSort,
  setSortDir,
  sortAxisLabel,
  sortCondKey,
  toggleSort,
} from './sort-conditions';

export interface SortPanelProps {
  conditions: FilterConditions;
  /** 局部更新:本面板只写 `sorts`(T2 起 UI 统一走 sorts) */
  onPatch: (value: Partial<FilterConditions>) => void;
}

// V5 口径:列表行 text-ui,按钮/选择器 rounded-xs(4px)+ text-label(12px)
const ROW = 'flex items-center gap-1.5 rounded-xs px-1.5 py-1 text-ui hover:bg-hover';
const BTN =
  'rounded-xs border border-border px-1.5 py-0.5 text-label text-muted hover:border-accent hover:text-accent-text ' +
  'disabled:cursor-default disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted';
const SELECT = 'h-7 rounded-xs border border-border bg-chrome px-1 text-label text-muted outline-none';
const ADD = 'rounded-xs border border-border px-2 py-1 text-label text-muted hover:border-accent hover:text-accent-text';

/** 维度决定方向取值顺序与文案(时间 = 新/旧;标签 = 选项顺序/倒序) */
const dirsFor = (c: SortCond): SortDir[] => (c.kind === 'time' ? ['desc', 'asc'] : ['asc', 'desc']);

export function SortPanel(p: SortPanelProps): ReactNode {
  const sorts = p.conditions.sorts;
  const [choosing, setChoosing] = useState(false);
  const [pickTag, setPickTag] = useState(false);
  const write = (next: SortCond[]): void => p.onPatch({ sorts: next });

  const full = sorts.length >= MAX_SORT_CONDS;
  const timeTaken = hasSortAxis(sorts, { kind: 'time', dir: 'desc', enabled: true });
  const tagPaths = sorts.flatMap((s) => (s.kind === 'tag' ? [s.path] : []));

  return (
    <div data-testid="sort-panel" role="group" aria-label="排序条件" className="w-72">
      {sorts.length === 0 && (
        <p className="px-1.5 py-1 text-label text-muted">默认:时间 新 -&gt; 旧</p>
      )}
      <ul className="mb-1">
        {sorts.map((c, i) => {
          const axis = sortAxisLabel(c);
          return (
            <li key={sortCondKey(c)} data-testid="sort-row" className={ROW}>
              <input
                type="checkbox"
                checked={c.enabled}
                aria-label={`启用 ${axis}`}
                onChange={() => write(toggleSort(sorts, i))}
              />
              <span className="min-w-0 flex-1 truncate" title={c.kind === 'tag' ? c.path : '时间'}>
                {axis}
              </span>
              <select
                className={SELECT}
                aria-label={`方向 ${axis}`}
                value={c.dir}
                onChange={(e) => write(setSortDir(sorts, i, e.target.value as SortDir))}
              >
                {dirsFor(c).map((d) => (
                  <option key={d} value={d}>
                    {dirLabel({ ...c, dir: d })}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={BTN}
                aria-label={`上移 ${axis}`}
                disabled={i === 0}
                onClick={() => write(moveSort(sorts, i, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className={BTN}
                aria-label={`下移 ${axis}`}
                disabled={i === sorts.length - 1}
                onClick={() => write(moveSort(sorts, i, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className={BTN}
                aria-label={`移除排序 ${axis}`}
                onClick={() => write(removeSort(sorts, i))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border pt-1">
        <button
          type="button"
          data-testid="sort-add"
          className={ADD}
          disabled={full}
          title={full ? `排序条件最多 ${MAX_SORT_CONDS} 条` : undefined}
          onClick={() => setChoosing((v) => !v)}
        >
          + 排序条件
        </button>
        {full && (
          <p data-testid="sort-cap-hint" className="px-1.5 py-0.5 text-label text-muted">
            排序条件最多 {MAX_SORT_CONDS} 条
          </p>
        )}
        {choosing && !full && (
          <div className="mt-1 flex items-center gap-1.5 px-1">
            <button
              type="button"
              data-testid="sort-add-time"
              className={ADD}
              disabled={timeTaken}
              title={timeTaken ? '时间已在排序条件中' : undefined}
              onClick={() => {
                write(addSort(sorts, { kind: 'time', dir: 'desc', enabled: true }));
                setChoosing(false);
              }}
            >
              时间
            </button>
            <button
              type="button"
              data-testid="sort-add-tag"
              className={ADD}
              onClick={() => {
                setPickTag(true);
                setChoosing(false);
              }}
            >
              标签轴
            </button>
          </div>
        )}
      </div>
      {pickTag && (
        <TagPickDialog
          exclude={false}
          selected={tagPaths}
          onClose={() => setPickTag(false)}
          onPick={(path) => {
            write(addSort(sorts, { kind: 'tag', path, dir: 'asc', enabled: true }));
            setPickTag(false);
          }}
        />
      )}
    </div>
  );
}

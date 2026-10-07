/**
 * 分组面板(设计 2026-10-06 §6):选轴(标签选择器) + 组间方向(选项顺序/倒序) + 清除。
 * 只写 `conditions.groupBy`(`onPatch({ groupBy })`);**分组不算收窄条件**,不影响命中数、不清空筛选。
 * 与 `SortPanel` 同口径:同一个「添加条件」浮层里,顺序相邻。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions, GroupByCond, SortDir } from '../../shared/filter-conditions';
import { tagLabelPlain } from '../../shared/tag-label';
import { groupDirLabel } from './group-by';
import { TagPickDialog } from './TagPickDialog';

export interface GroupByPanelProps {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
}

const ROW = 'flex items-center gap-1.5 rounded-xs px-1.5 py-1 text-ui';
const BTN =
  'rounded-xs border border-border px-1.5 py-0.5 text-label text-muted hover:border-accent hover:text-accent-text';
const SELECT = 'h-7 rounded-xs border border-border bg-chrome px-1 text-label text-muted outline-none';
const ADD = 'rounded-xs border border-border px-2 py-1 text-label text-muted hover:border-accent hover:text-accent-text';

/** 组间方向两档:asc = 选项顺序 / desc = 选项倒序 */
const DIRS: SortDir[] = ['asc', 'desc'];

export function GroupByPanel(p: GroupByPanelProps): ReactNode {
  const [pick, setPick] = useState(false);
  const g = p.conditions.groupBy;
  const write = (next: GroupByCond | null): void => p.onPatch({ groupBy: next });

  return (
    <div data-testid="group-panel" role="group" aria-label="分组条件" className="w-72">
      {g === null ? (
        <p className="px-1.5 py-1 text-label text-muted">默认:不分组</p>
      ) : (
        <div className={ROW}>
          <span className="min-w-0 flex-1 truncate" title={g.path}>
            {tagLabelPlain(g.path)}
          </span>
          <select
            className={SELECT}
            aria-label="组间方向"
            value={g.dir}
            onChange={(e) => write({ ...g, dir: e.target.value as SortDir })}
          >
            {DIRS.map((d) => (
              <option key={d} value={d}>
                {groupDirLabel(d)}
              </option>
            ))}
          </select>
          <button type="button" className={BTN} aria-label="清除分组" onClick={() => write(null)}>
            清除
          </button>
        </div>
      )}
      <div className="border-t border-border pt-1">
        <button
          type="button"
          data-testid="group-add"
          className={ADD}
          onClick={() => setPick(true)}
        >
          + 分组轴
        </button>
      </div>
      {pick && (
        <TagPickDialog
          exclude={false}
          selected={g === null ? [] : [g.path]}
          onClose={() => setPick(false)}
          onPick={(path) => {
            // 换轴保留已选方向(选项顺序/倒序是用户对「组间怎么排」的意图,与具体轴无关)
            write({ path, dir: g?.dir ?? 'asc' });
            setPick(false);
          }}
        />
      )}
    </div>
  );
}

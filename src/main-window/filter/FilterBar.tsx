import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import { AddConditionMenu } from './AddConditionMenu';
import { ExprDialog } from './ExprDialog';
import { FilterChips } from './FilterChips';
import { TagPickDialog } from './TagPickDialog';
import { applyTagPick, chipsOf, summaryOf, summaryTitleOf } from './filter-chips';

export interface FilterBarProps {
  /** 顶层筛选条件(标签选中态与排序都从这里派生) */
  conditions: FilterConditions;
  /** 局部更新条件 */
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 导出(整库 xlsx;未传则不渲染按钮) */
  onExport?: () => void;
  exporting?: boolean;
  exported?: boolean;
}

/**
 * 条件栏:条件 chips + 添加条件 | 排序 | 导出(可选)。
 * 关键词输入框已删(Task 7 清扫被取代的旧输入框):`/` 模式在唯一输入框里做实时筛选,
 * 已生效的关键词以 chip 显示、可单删。
 * 标签选点入口已收敛到侧栏(主入口)与本栏「添加条件」的标签选择器(排除/仅本级);
 * 旧标签板(仅本级链接的平铺 chips)移除,条件 chips 的显示/单删保留。
 */
export function FilterBar(p: FilterBarProps): ReactNode {
  const activePaths = p.conditions.tags.map((t) => t.path);
  // 两侧已选路径合集:同一标签同时进 tags 与 excludeTags 结果恒空,任一侧已含即禁选
  const pickedPaths = [...activePaths, ...p.conditions.excludeTags.map((t) => t.path)];
  const oldestFirst = p.conditions.sort === 'oldest';

  const [tagPick, setTagPick] = useState<{ exclude: boolean } | null>(null);
  const [exprOpen, setExprOpen] = useState(false);

  const summary = summaryOf(p.conditions);
  const summaryTitle = summaryTitleOf(p.conditions);

  return (
    <div className="border-b border-border px-4 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => p.onPatch({ sort: oldestFirst ? 'newest' : 'oldest' })}
          className="h-8 shrink-0 rounded-sm border border-border px-2.5 text-ui text-muted hover:border-accent hover:text-accent-text"
        >
          排序: {oldestFirst ? '最早' : '最新'}
        </button>
        <AddConditionMenu
          conditions={p.conditions}
          onPatch={p.onPatch}
          onPickTag={(exclude) => setTagPick({ exclude })}
          onOpenExpr={() => setExprOpen(true)}
        />
        {p.onExport && (
          <>
            {p.exported && <span className="shrink-0 text-ui text-success">已导出</span>}
            <button
              onClick={p.onExport}
              disabled={p.exporting}
              title="导出全部笔记(不受筛选影响)"
              className="h-8 shrink-0 rounded-sm border border-border px-2.5 text-ui text-muted hover:border-accent hover:text-accent-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              {p.exporting ? '导出中' : '导出全部'}
            </button>
          </>
        )}
      </div>
      <FilterChips
        chips={chipsOf(p.conditions)}
        onRemove={(next) => p.onPatch(next)}
        onEditExpr={() => setExprOpen(true)}
      />
      {summary !== '' && (
        <p className="mt-1 truncate text-label text-faint" title={summaryTitle}>
          {summary}
        </p>
      )}
      {tagPick && (
        <TagPickDialog
          exclude={tagPick.exclude}
          selected={pickedPaths}
          onClose={() => setTagPick(null)}
          onPick={(path, includeChildren) => {
            p.onPatch(applyTagPick(p.conditions, path, { exclude: tagPick.exclude, includeChildren }));
            setTagPick(null);
          }}
        />
      )}
      {exprOpen && (
        <ExprDialog
          value={p.conditions.expr}
          onClose={() => setExprOpen(false)}
          onSave={(e) => p.onPatch({ expr: e.trim() === '' ? null : e })}
        />
      )}
    </div>
  );
}

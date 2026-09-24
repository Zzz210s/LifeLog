import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import { AddConditionMenu } from './AddConditionMenu';
import { ExprDialog } from './ExprDialog';
import { FilterChips } from './FilterChips';
import { TagPickDialog } from './TagPickDialog';
import { applyTagPick, chipsOf, summaryOf, summaryTitleOf } from './filter-chips';

export interface ConditionBarProps {
  /** 顶层筛选条件(chips 与中文摘要都从这里派生) */
  conditions: FilterConditions;
  /** 局部更新条件 */
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 命令/顶栏菜单要打开"添加条件"时由上层置真 */
  addConditionOpen: boolean;
  onAddConditionOpenChange: (open: boolean) => void;
}

/**
 * 条件栏(Task 2 瘦身):只剩条件 chips + 中文摘要。
 * 排序 / 添加条件 / 导出三个按钮已搬走 —— 排序与添加条件走 `>` 命令,鼠标入口在顶栏溢出菜单(Task 3);
 * 「添加条件」下拉的浮层仍锚在本栏,开关由上层给(受控),本栏不再放触发按钮。
 * 关键词输入框更早已删(计划 1/3):`/` 模式在唯一输入框里做实时筛选,
 * 已生效的关键词以 chip 显示、可单删。标签选点入口在侧栏与本栏「添加条件」的标签选择器。
 */
export function ConditionBar(p: ConditionBarProps): ReactNode {
  // 两侧已选路径合集:同一标签同时进 tags 与 excludeTags 结果恒空,任一侧已含即禁选
  const pickedPaths = [
    ...p.conditions.tags.map((t) => t.path),
    ...p.conditions.excludeTags.map((t) => t.path),
  ];
  // 两个对话框的开关只由「添加条件」菜单触发,所以留在本组件里
  const [tagPick, setTagPick] = useState<{ exclude: boolean } | null>(null);
  const [exprOpen, setExprOpen] = useState(false);

  const summary = summaryOf(p.conditions);
  const summaryTitle = summaryTitleOf(p.conditions);

  return (
    <div data-testid="condition-bar" className="border-b border-border px-4 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          chips={chipsOf(p.conditions)}
          onRemove={(next) => p.onPatch(next)}
          onEditExpr={() => setExprOpen(true)}
        />
        {summary !== '' && (
          <span
            data-testid="condition-bar-summary"
            className="truncate text-label text-muted"
            title={summaryTitle}
          >
            {summary}
          </span>
        )}
        <AddConditionMenu
          showTrigger={false}
          open={p.addConditionOpen}
          onOpenChange={p.onAddConditionOpenChange}
          conditions={p.conditions}
          onPatch={p.onPatch}
          onPickTag={(exclude) => setTagPick({ exclude })}
          onOpenExpr={() => setExprOpen(true)}
        />
      </div>
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

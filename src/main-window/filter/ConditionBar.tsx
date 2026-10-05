import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { ConditionHits } from '../../shared/tag-facts-types';
import { AddConditionMenu } from './AddConditionMenu';
import { ExprDialog } from './ExprDialog';
import { FilterChips } from './FilterChips';
import { TypePickDialog } from './TypePickDialog';
import { TagPickDialog } from './TagPickDialog';
import { applyTypePick, applyTagPick, chipsOf, summarySegmentsOf, summaryTitleOf } from './filter-chips';
import type { CarryPaths } from './filter-chips';

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
  // 两侧已选路径合集:同一标签同时进 tags 与 excludeTags 结果恒空,任一侧已含即禁选;类型同理
  const pickedPaths = [
    ...p.conditions.tags.map((t) => t.path),
    ...p.conditions.excludeTags.map((t) => t.path),
  ];
  const pickedTypePaths = [
    ...p.conditions.types.map((r) => r.path),
    ...p.conditions.excludeTypes.map((r) => r.path),
  ];
  // 两个对话框的开关只由「添加条件」菜单触发,所以留在本组件里
  const [tagPick, setTagPick] = useState<{ exclude: boolean } | null>(null);
  const [typePick, setTypePick] = useState<{ exclude: boolean } | null>(null);
  const [exprOpen, setExprOpen] = useState(false);
  // 有携带者的标签路径集合;初值空集 = 加载中(先不标) —— 真实库 0 条携带行时不会闪 +携带
  const [carryPaths, setCarryPaths] = useState<CarryPaths>(new Set());
  // 标签 / 类型条件的独立命中数(后端单条件计数,与 query_notes 同谓词)
  const [hits, setHits] = useState<ConditionHits | null>(null);
  const condKey = filterKey(p.conditions);

  // 挂载 / 条件变化时批量取一次(不每个 chip 一次 IPC)。condKey 有意当刷新信号:携带关系是
  // 全局集合、与条件无关,但条件变更顺带重取,省一条跨栏事件通道。加载中保持上一轮结果(不闪);
  // 只有 IPC 失败才置 null(退回「都显示」,spec 兜底)。
  useEffect(() => {
    let stale = false;
    api
      .carriedTagPaths()
      .then((paths) => {
        if (!stale) setCarryPaths(new Set(paths));
      })
      .catch(() => {
        if (!stale) setCarryPaths(null);
      });
    return () => {
      stale = true;
    };
  }, [condKey]);

  // 命中数只在真有标签/类型条件时才取(空条件没有可数的 chip)
  const hasTagType =
    p.conditions.tags.length > 0 ||
    p.conditions.excludeTags.length > 0 ||
    p.conditions.types.length > 0 ||
    p.conditions.excludeTypes.length > 0;

  useEffect(() => {
    let stale = false;
    if (!hasTagType) {
      setHits(null);
      return;
    }
    api
      .conditionHitCounts(p.conditions)
      .then((h) => {
        if (!stale) setHits(h);
      })
      .catch(() => {
        if (!stale) setHits(null);
      });
    return () => {
      stale = true;
    };
    // hasTagType 由 conditions 派生;条件一变就重取,失败回 null(不显示小字)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condKey]);

  const summarySegments = summarySegmentsOf(p.conditions, true, carryPaths);
  const summaryTitle = summaryTitleOf(p.conditions, carryPaths);

  return (
    <div data-testid="condition-bar" className="border-b border-border px-4 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          chips={chipsOf(p.conditions, hits)}
          onRemove={(next) => p.onPatch(next)}
          onEditExpr={() => setExprOpen(true)}
        />
        {summarySegments.length > 0 && (
          <span
            data-testid="condition-bar-summary"
            className="truncate text-label text-muted"
            title={summaryTitle}
          >
            {summarySegments.map((s, i) =>
              s.carry ? (
                <span key={i} className="text-micro opacity-70">
                  {s.text}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              )
            )}
          </span>
        )}
        <AddConditionMenu
          showTrigger={false}
          open={p.addConditionOpen}
          onOpenChange={p.onAddConditionOpenChange}
          conditions={p.conditions}
          onPatch={p.onPatch}
          onPickTag={(exclude) => setTagPick({ exclude })}
          onPickType={(exclude) => setTypePick({ exclude })}
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
      {typePick && (
        <TypePickDialog
          exclude={typePick.exclude}
          selected={pickedTypePaths}
          onClose={() => setTypePick(null)}
          onPick={(path) => {
            p.onPatch(applyTypePick(p.conditions, path, typePick.exclude));
            setTypePick(null);
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

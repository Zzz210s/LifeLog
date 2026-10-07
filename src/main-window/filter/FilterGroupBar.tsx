import type { ReactNode } from 'react';
import { addGroup, removeGroup, setGlobalGroupOp, setGroupOp, uiGroups } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { ConditionHits } from '../../shared/tag-facts-types';

export interface FilterGroupBarProps {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 后端读数:OR 组给整组命中数(组头小字),AND 组不给 */
  hits: ConditionHits | null;
}

const BOX =
  'inline-flex items-center gap-1 rounded-xs border border-border bg-chrome px-1.5 py-0.5 text-micro text-muted';
const OP_BTN =
  'rounded-xs border border-border px-1 leading-none text-muted hover:border-accent hover:text-accent-text';

/** 条件组工具条(设计 2026-10-06 §5.5):每个组一个组头,可切组内 且/或、可删组;
 *  组与组之间一个「组间 且/或」;OR 组在组头显示「组命中 N 条」(chip 上不给单条读数)。 */
export function FilterGroupBar(p: FilterGroupBarProps): ReactNode {
  const groups = uiGroups(p.conditions);
  if (groups.length === 0) return null;
  const groupOp = p.conditions.groupOp === 'or' ? 'or' : 'and';
  const flip = (op: 'and' | 'or') => (op === 'and' ? 'or' : 'and');
  // 后端读数按**非空组**给出(空组不进谓词),这里同样跳过空组对齐
  let hitIdx = -1;
  return (
    <div data-testid="filter-group-bar" className="mt-1 flex flex-wrap items-center gap-1">
      {groups.map((g, gi) => {
        if (g.items.length > 0) hitIdx += 1;
        const groupHit = g.items.length > 0 ? p.hits?.groups?.[hitIdx]?.groupHit ?? null : null;
        return (
          <span key={gi} className={BOX} data-testid={`filter-group-${gi}`}>
            {gi > 0 && (
              <button
                type="button"
                aria-label="切换组间关系"
                title="组间关系"
                className={OP_BTN}
                onClick={() => p.onPatch(setGlobalGroupOp(p.conditions, flip(groupOp)))}
              >
                {groupOp === 'and' ? '且' : '或'}
              </button>
            )}
            <span>{`组 ${gi + 1}`}</span>
            <button
              type="button"
              aria-label={`切换第 ${gi + 1} 组组内关系`}
              title="组内关系"
              className={OP_BTN}
              onClick={() => p.onPatch(setGroupOp(p.conditions, gi, flip(g.op)))}
            >
              {g.op === 'and' ? '且' : '或'}
            </button>
            {groupHit !== null && <span>{`组命中 ${groupHit} 条`}</span>}
            <button
              type="button"
              aria-label={`删除第 ${gi + 1} 组`}
              title={`删除第 ${gi + 1} 组`}
              className="rounded-xs px-0.5 leading-none opacity-60 hover:opacity-100"
              onClick={() => p.onPatch(removeGroup(p.conditions, gi))}
            >
              ×
            </button>
            <button
              type="button"
              aria-label={`在第 ${gi + 1} 组后再加一组`}
              title="在后面再加一组"
              className="rounded-xs px-0.5 leading-none opacity-60 hover:opacity-100"
              onClick={() => p.onPatch(addGroup(p.conditions))}
            >
              +
            </button>
          </span>
        );
      })}
    </div>
  );
}

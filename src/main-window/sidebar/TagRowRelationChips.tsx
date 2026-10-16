/**
 * 标签行的关系小字段(2026-10-16 从 `TagRow` 原样搬出):chip = 「名字 + 被引用点」(不画箭头),
 * 按值去重后最多 2 个 + `+N`;行级 data-tip / data-tip-rows(`tagFactsRows`,不去重)也在这里。
 * 小字**没有自己的 onClick**:点击冒泡到行,跟随整行意图(设计 §4.3 第 15 行)。
 */
import type { ReactNode } from 'react';
import {
  relationPlan,
  relationValue,
  relationValueTip,
  tagFactsRows,
  tagLeafName,
  uniqueRelationValues,
} from '../../shared/tag-relation-facts';
import { hoverTitle } from '../../shared/truncate-title';
import type { RelationRef } from '../../shared/types';

export interface RowRelationTips {
  /** 行级 data-tip(名字截断时由名字块的原生 title 兜底)与 data-tip-rows(悬浮卡片一行一条的 JSON) */
  title?: string;
  rows?: string;
}

/** 行级悬浮档案卡片的两条数据属性(没有关系就两条都不挂) */
export function rowRelationTips(path: string, relations: readonly RelationRef[]): RowRelationTips {
  const rows = tagFactsRows(relations);
  return rows.length === 0 ? {} : { title: tagLeafName(path), rows: JSON.stringify(rows) };
}

export interface TagRowRelationChipsProps {
  /** 本行的全部出边(A -> ?) */
  relations: readonly RelationRef[];
  /** 设置开关「实体树里显示引用」:关时一行都不出(悬浮卡片仍在) */
  show: boolean;
}

/** 行内关系小字:紧跟标签名、计数导轨之前;无名字线只给值(与 v30 逐字相同) */
export function TagRowRelationChips(p: TagRowRelationChipsProps): ReactNode {
  if (!p.show) return null;
  const { shown, extra } = relationPlan(uniqueRelationValues(p.relations));
  return (
    <>
      {shown.map((r, i) => {
        const value = relationValue(r);
        const name = relationValueTip(r);
        const text = name === '' ? value : `${name} ${value}`;
        return (
          <span
            key={`${r.toTagId}-${i}`}
            data-tag-relation
            data-tip={name === '' ? undefined : name}
            className="min-w-0 max-w-[8rem] shrink truncate rounded-xs bg-tag px-1 text-micro text-muted"
            onMouseEnter={hoverTitle(text)}
          >
            {text}
          </span>
        );
      })}
      {extra > 0 && (
        <span data-tag-relation className="shrink-0 text-micro text-muted">
          {'+' + extra}
        </span>
      )}
    </>
  );
}

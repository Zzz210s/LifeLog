import type { ReactNode } from 'react';
import { entityBadge } from '../shared/entity-pool';
import { highlightLabel } from '../main-window/palette/PaletteRow';
import { SUGGEST_MAX_ROWS, SUGGEST_PAD_CSS, SUGGEST_ROW_CSS } from '../shared/input-geometry';
import type { ListRow } from '../shared/quickpick/model';

export interface LinkCompleteListProps {
  items: readonly ListRow[];
  activeIndex: number;
  /** 树内行 id 集合(实体 id 的字符串形);缺省空集 = 全部按树外标 */
  inTreeIds?: ReadonlySet<string>;
  /** 采纳选中行:鼠标与键盘共用(行携带 item.id,供 MRU 记账) */
  onPick: (row: ListRow) => void;
}

/** 行尾徽标:树内 / 树外(文案真源 `shared/entity-pool` 的 `entityBadge`) */
export function KindBadge(p: { inTree: boolean }): ReactNode {
  return (
    <span
      className="ml-2 shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-faint"
      title={p.inTree ? '树内实体:采纳后引用它' : '树外实体:采纳后引用它'}
    >
      {entityBadge(p.inTree)}
    </span>
  );
}

/**
 * 输入栏 `[[` 补全候选列表:与 `TagCompleteList`(标签补全)同款外观 —— 长在输入框正下方、
 * 占窗口内的独立高度、行高固定 SUGGEST_ROW_CSS,不用内部滚动。
 *
 * 与标签列表的差别只有两处:这里展示**实体显示首行**(不是标签路径),命中段直接来自打分器
 * (`ListRow.ranges`),渲染复用浮层的 `highlightLabel`(纪律 1:UI 不另写 matcher);行尾按
 * `inTreeIds` 标「树内 / 树外」—— 补全池是**全部实体**(计划 T3.2),徽标说清这行会不会进树。
 * onMouseDown + preventDefault 保住 textarea 焦点与光标(采纳要读光标位置)。
 */
export function LinkCompleteList(p: LinkCompleteListProps): ReactNode {
  if (p.items.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="笔记补全候选"
      data-testid="link-suggest"
      className="w-full shrink-0 border-t border-border bg-raised"
      style={{
        maxHeight: SUGGEST_MAX_ROWS * SUGGEST_ROW_CSS + SUGGEST_PAD_CSS,
        paddingTop: 4,
        paddingBottom: 4,
      }}
    >
      {p.items.map((it, i) => {
        const active = i === p.activeIndex;
        return (
          <button
            key={it.item.id}
            type="button"
            role="option"
            aria-selected={active}
            title={it.item.label}
            style={{ height: SUGGEST_ROW_CSS }}
            onMouseDown={(e) => {
              e.preventDefault();
              p.onPick(it);
            }}
            className={
              'flex w-full items-center px-3 text-left text-xs ' +
              (active ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-hover')
            }
          >
            <span className="min-w-0 flex-1 truncate">{highlightLabel(it.item.label, it.ranges)}</span>
            <KindBadge inTree={p.inTreeIds?.has(it.item.id) ?? false} />
          </button>
        );
      })}
    </div>
  );
}

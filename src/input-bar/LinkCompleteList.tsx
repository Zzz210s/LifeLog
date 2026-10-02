import type { ReactNode } from 'react';
import { highlightLabel } from '../main-window/palette/PaletteRow';
import { SUGGEST_MAX_ROWS, SUGGEST_PAD_CSS, SUGGEST_ROW_CSS } from '../shared/input-geometry';
import type { ListRow } from '../shared/quickpick/model';

export interface LinkCompleteListProps {
  items: readonly ListRow[];
  activeIndex: number;
  /** 采纳:恒传被选中行的完整标题(写回 `[[标题]]`) */
  onPick: (title: string) => void;
}

/**
 * 输入栏 `[[` 补全候选列表:与 `TagCompleteList`(标签补全)同款外观 —— 长在输入框正下方、
 * 占窗口内的独立高度、行高固定 SUGGEST_ROW_CSS,不用内部滚动。
 *
 * 与标签列表的差别只有一行内容:这里展示**笔记标题**(不是标签路径),命中段直接来自打分器
 * (`ListRow.ranges`),渲染复用浮层的 `highlightLabel`(纪律 1:UI 不另写 matcher)。标题里的
 * markdown 语法原样显示(它不是标签名,不走 `tagLabelPlain` 那套显示口径)。
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
              p.onPick(it.item.label);
            }}
            className={
              'flex w-full items-center px-3 text-left text-xs ' +
              (active ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-hover')
            }
          >
            <span className="min-w-0 flex-1 truncate">{highlightLabel(it.item.label, it.ranges)}</span>
          </button>
        );
      })}
    </div>
  );
}

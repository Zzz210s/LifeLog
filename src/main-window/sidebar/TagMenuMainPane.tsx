import type { ReactNode } from 'react';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import { relationPlan, tagFactsRows, type RelationFactLike } from '../../shared/tag-relation-facts';
import { ITEM_CLASS } from './tag-menu-ui';
import type { Pane } from './tag-menu-ui';

/** 主面板最多直接列出几条关系:再多菜单就被撑长,余数用 `+N` 概括 */
export const MENU_RELATION_MAX = 4;

export interface TagMenuMainPaneProps {
  /** 目标标签完整路径(菜单标题,悬浮可见全路径) */
  path: string;
  /** 选择面板(进入前由上层清掉就地错误;删除面板额外重置影响面) */
  onPick: (pane: Pane) => void;
  /** 本标签的出边(属性名 + 值);undefined = 读数还没回来,一行都不列 */
  relations?: readonly RelationFactLike[];
}

/** 主面板:重命名 / 移动 / 别名 / 关系 / 删除五档;标题的标签名走行内 md 预览态(T1)。
 *  标题下方**直接列出本标签的关系**(2026-10-06 用户口径):每条一行,左列属性名(muted)、
 *  右列值,复用 `tagFactsRows` 同一投影;属性名缺失时左列回退目标名(R12)。 */
export function TagMenuMainPane(p: TagMenuMainPaneProps): ReactNode {
  const { shown, extra } = relationPlan(tagFactsRows(p.relations ?? []), MENU_RELATION_MAX);
  return (
    <>
      <p className="truncate px-2.5 py-1 text-label font-medium text-muted" onMouseEnter={hoverTitle(tagLabelPlain(p.path))}>
        {renderTagLabel(p.path)}
      </p>
      {shown.length > 0 && (
        <div data-menu-relations className="pb-0.5">
          {shown.map((row, i) => (
            <div key={i} data-menu-relation className="flex items-baseline gap-1.5 px-2.5 py-0.5 text-label">
              <span data-menu-relation-label className="shrink-0 text-muted">
                {row.label}
              </span>
              <span data-menu-relation-value className="min-w-0 truncate text-text">
                {row.value}
              </span>
            </div>
          ))}
          {extra > 0 && <div className="px-2.5 py-0.5 text-label text-muted">{`+${extra}`}</div>}
        </div>
      )}
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('rename')}>
        重命名
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('move')}>
        移动
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('alias')}>
        别名…
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('relation')}>
        关系…
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('delete')}>
        删除
      </button>
    </>
  );
}

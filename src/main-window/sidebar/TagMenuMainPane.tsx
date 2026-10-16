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
  /** 该行在筛选的包含侧(两个 scope 档的 aria-checked 依据) */
  inIncluded: boolean;
  /** 在包含侧时的口径:仅本级(false)/ 含子级(true) */
  includeChildren: boolean;
  /** 已在排除侧:排除档文案变「移出排除」 */
  excluded: boolean;
  /** 仅看本级(false)/ 含子级(true),落 `setTagScope` */
  onScope: (includeChildren: boolean) => void;
  /** 加入 / 移出排除(切换),落 `toggleExcludeTag` */
  onToggleExclude: () => void;
}

/** 主面板 **8 档**:仅看本级 / 含子级 / 加入-移出排除(条件动作,设计 2026-10-16 §5.6)+ 现状 5 档管理动作。
 *  条件档不做禁用态(不在包含侧时点了就以该口径加入);标题的标签名走行内 md 预览态(T1),
 *  标题下方**直接列出本实体的引用**(2026-10-06 用户口径),复用 `tagFactsRows` 同一投影。
 *  「引用…」= spec §5.3 入口处置:与正文 `#X` / `[[X]]` 归到同一套「引用」概念(都落 `link` 边)。 */
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
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={p.inIncluded && !p.includeChildren}
        data-menu-action="scope-self"
        className={ITEM_CLASS}
        onClick={() => p.onScope(false)}
      >
        仅看本级
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={p.inIncluded && p.includeChildren}
        data-menu-action="scope-subtree"
        className={ITEM_CLASS}
        onClick={() => p.onScope(true)}
      >
        含子级
      </button>
      <button type="button" role="menuitem" data-menu-action="exclude" className={ITEM_CLASS} onClick={p.onToggleExclude}>
        {p.excluded ? '移出排除' : '加入排除'}
      </button>
      <button type="button" role="menuitem" data-menu-action="rename" className={ITEM_CLASS} onClick={() => p.onPick('rename')}>
        重命名
      </button>
      <button type="button" role="menuitem" data-menu-action="move" className={ITEM_CLASS} onClick={() => p.onPick('move')}>
        移动
      </button>
      <button type="button" role="menuitem" data-menu-action="alias" className={ITEM_CLASS} onClick={() => p.onPick('alias')}>
        别名…
      </button>
      <button type="button" role="menuitem" data-menu-action="relation" className={ITEM_CLASS} onClick={() => p.onPick('relation')}>
        关系…
      </button>
      <button type="button" role="menuitem" data-menu-action="delete" className={ITEM_CLASS} onClick={() => p.onPick('delete')}>
        删除
      </button>
    </>
  );
}

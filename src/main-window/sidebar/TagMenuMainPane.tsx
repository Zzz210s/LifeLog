import type { ReactNode } from 'react';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import { ITEM_CLASS } from './tag-menu-ui';
import type { Pane } from './tag-menu-ui';

export interface TagMenuMainPaneProps {
  /** 目标标签完整路径(菜单标题,悬浮可见全路径) */
  path: string;
  /** 该标签是否已登记为类型(决定第三档显示「设为类型」还是「取消类型」) */
  isType: boolean;
  /** 选择面板(进入前由上层清掉就地错误;删除面板额外重置影响面) */
  onPick: (pane: Pane) => void;
  /** 「设为类型 / 取消类型」一下:登记动作登记、已是类型则取消登记 */
  onMakeType: () => void;
}

/** 主面板:重命名 / 移动 / 别名 / 合并 / 携带 / 删除六个入口;标题的标签名走行内 md 预览态(T1) */
export function TagMenuMainPane(p: TagMenuMainPaneProps): ReactNode {
  return (
    <>
      <p className="truncate px-2.5 py-1 text-label font-medium text-muted" onMouseEnter={hoverTitle(tagLabelPlain(p.path))}>
        {renderTagLabel(p.path)}
      </p>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('rename')}>
        重命名
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('move')}>
        移动
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('alias')}>
        别名…
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('merge')}>
        合并…
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('carry')}>
        携带…
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('type')}>
        类型…
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={p.onMakeType}>
        {p.isType ? '取消类型' : '设为类型'}
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('delete')}>
        删除
      </button>
    </>
  );
}

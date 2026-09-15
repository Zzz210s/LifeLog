import type { ReactNode } from 'react';
import { ITEM_CLASS } from './tag-menu-ui';
import type { Pane } from './tag-menu-ui';

export interface TagMenuMainPaneProps {
  /** 目标标签完整路径(菜单标题,悬浮可见全路径) */
  path: string;
  /** 选择面板(进入前由上层清掉就地错误;删除面板额外重置影响面) */
  onPick: (pane: Pane) => void;
}

/** 主面板:重命名 / 移动 / 删除三个入口 */
export function TagMenuMainPane(p: TagMenuMainPaneProps): ReactNode {
  return (
    <>
      <p className="truncate px-2.5 py-1 text-xs font-medium text-faint" title={p.path}>
        {p.path}
      </p>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('rename')}>
        重命名
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('move')}>
        移动
      </button>
      <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => p.onPick('delete')}>
        删除
      </button>
    </>
  );
}

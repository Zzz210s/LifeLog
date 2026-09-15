import type { ReactNode } from 'react';
import type { TagCount } from '../../shared/types';
import { BTN_GHOST, ITEM_CLASS } from './tag-menu-ui';

export interface TagMenuMovePaneProps {
  /** 被移动标签的末级名(用于拼出目标路径) */
  nodeName: string;
  /** 候选父级(上层已剔除自身与子孙),按原路径序展示 */
  candidates: TagCount[];
  /** 当前父级路径(空串表示已在根级),用于给候选行加"当前"标记 */
  currentParent: string;
  /** 请求进行中:禁用候选按钮 */
  busy: boolean;
  /** 就地错误(空串表示无) */
  error: string;
  onCancel: () => void;
  /** parentId=null 移到根级;to 为移动后的完整路径 */
  onMove: (parentId: number | null, to: string) => void;
}

/** 移动面板:根级 + 候选父级列表(带当前项高亮与缩进) */
export function TagMenuMovePane(p: TagMenuMovePaneProps): ReactNode {
  return (
    <div className="p-1">
      <p className="mb-1 px-1 text-xs text-faint">移动「{p.nodeName}」到</p>
      <button
        type="button"
        onClick={() => p.onMove(null, p.nodeName)}
        className={ITEM_CLASS + (p.currentParent === '' ? ' bg-accent-soft text-accent' : '')}
      >
        (根级){p.currentParent === '' ? ' - 当前' : ''}
      </button>
      {p.candidates.map((r) => (
        <button
          key={r.path}
          type="button"
          title={r.path}
          disabled={p.busy}
          onClick={() => p.onMove(r.id, r.path + '/' + p.nodeName)}
          style={{ paddingLeft: 10 + r.depth * 12 }}
          className={ITEM_CLASS + (r.path === p.currentParent ? ' bg-accent-soft text-accent' : '')}
        >
          {r.path}
          {r.path === p.currentParent ? ' - 当前' : ''}
        </button>
      ))}
      {p.error !== '' && <p className="mt-1 px-1 text-xs text-danger">{p.error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={p.onCancel} className={BTN_GHOST}>
          取消
        </button>
      </div>
    </div>
  );
}

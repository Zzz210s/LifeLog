/**
 * 关系面板上半「当前关系」列表(自 TagMenuRelationPane 拆出,守 200 行红线):
 * 只负责渲染已读到的出边(`备注 → 目标`,无备注回退目标名)与逐行「移除」;
 * 读数 / 写库 / 错误都在容器里,传 null 表示读数还没回来(显示加载中,而不是误报空)。
 */
import type { ReactNode } from 'react';
import { tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import { relationLabel } from '../../shared/tag-relation-facts';
import type { RelationRef } from '../../shared/types';
import { BTN_TEXT } from '../shell/button-classes';

export interface TagMenuRelationListProps {
  /** 当前全部出边;null = 加载中 */
  relations: readonly RelationRef[] | null;
  busy: boolean;
  onRemove: (toTagId: number) => void;
}

export function TagMenuRelationList(p: TagMenuRelationListProps): ReactNode {
  return (
    <>
      <p className="px-1 text-label text-muted">当前关系</p>
      {p.relations === null && <p className="px-1 py-1 text-label text-muted">加载中…</p>}
      {p.relations !== null && p.relations.length === 0 && (
        <p className="px-1 py-1 text-label text-muted">还没有建立任何关系</p>
      )}
      {p.relations?.map((r) => (
        <div key={r.toTagId} className="flex items-center gap-1">
          <span
            className="min-w-0 flex-1 truncate px-1 py-1 text-label text-muted"
            onMouseEnter={hoverTitle(relationLabel(r))}
          >
            {relationLabel(r)}
          </span>
          <button
            type="button"
            data-relation-remove={r.toTagId}
            disabled={p.busy}
            title={'移除关系 ' + tagLabelPlain(r.name)}
            onClick={() => p.onRemove(r.toTagId)}
            className={BTN_TEXT + ' text-muted hover:text-danger'}
          >
            移除
          </button>
        </div>
      ))}
    </>
  );
}

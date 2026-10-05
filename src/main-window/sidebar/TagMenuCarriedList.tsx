/**
 * 携带面板上半「当前携带」列表(自 TagMenuCarryPane 拆出,守 200 行红线):
 * 只负责渲染已读到的携带目标与逐行「移除」;读数 / 写库 / 错误都在容器里,
 * 传 null 表示读数还没回来(显示加载中,而不是误报空)。
 */
import type { ReactNode } from 'react';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import type { TagRef } from '../../shared/types';
import { BTN_TEXT } from '../shell/button-classes';

export interface TagMenuCarriedListProps {
  /** 当前携带的标签;null = 加载中 */
  carried: readonly TagRef[] | null;
  busy: boolean;
  onRemove: (id: number) => void;
}

export function TagMenuCarriedList(p: TagMenuCarriedListProps): ReactNode {
  return (
    <>
      <p className="px-1 text-label text-muted">当前携带</p>
      {p.carried === null && <p className="px-1 py-1 text-label text-muted">加载中…</p>}
      {p.carried !== null && p.carried.length === 0 && (
        <p className="px-1 py-1 text-label text-muted">还没有携带任何标签</p>
      )}
      {p.carried?.map((c) => (
        <div key={c.id} className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate px-1 py-1 text-label text-muted" onMouseEnter={hoverTitle(tagLabelPlain(c.path))}>
            {renderTagLabel(c.path)}
          </span>
          <button
            type="button"
            data-carry-remove={c.id}
            disabled={p.busy}
            title={'移除携带 ' + tagLabelPlain(c.path)}
            onClick={() => p.onRemove(c.id)}
            className={BTN_TEXT + ' text-muted hover:text-danger'}
          >
            移除
          </button>
        </div>
      ))}
    </>
  );
}

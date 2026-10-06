/**
 * 关系面板上半「当前关系」列表(自 TagMenuRelationPane 拆出,守 200 行红线):
 * 只负责渲染已读到的出边(`属性名 → 目标`,属性名为空回退目标名)、逐行编辑属性名与「移除」;
 * 读数 / 写库 / 错误都在容器里,传 null 表示读数还没回来(显示加载中,而不是误报空)。
 *
 * 属性名存在**边**上(迁移 023),所以在行上就能改:失焦或 Enter 提交(值没变则不发 IPC)。
 */
import { useState } from 'react';
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
  /** 就地改属性名(值没变时上层不写库) */
  onEditRemark: (toTagId: number, remark: string) => void;
}

const REMARK_INPUT_CLASS =
  'h-7 w-24 shrink-0 rounded-sm border border-border-strong bg-raised px-1.5 text-label text-text outline-none';

export function TagMenuRelationList(p: TagMenuRelationListProps): ReactNode {
  /** 未提交的草稿:key = 目标 id;读回来的读数变了也不打断正在输入的内容 */
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const commit = (r: RelationRef, next: string): void => {
    if (next.trim() !== r.remark) p.onEditRemark(r.toTagId, next);
  };

  return (
    <>
      <p className="px-1 text-label text-muted">当前关系</p>
      {p.relations === null && <p className="px-1 py-1 text-label text-muted">加载中…</p>}
      {p.relations !== null && p.relations.length === 0 && (
        <p className="px-1 py-1 text-label text-muted">还没有建立任何关系</p>
      )}
      {p.relations?.map((r) => (
        <div key={r.toTagId} className="flex items-center gap-1">
          <input
            data-relation-remark={r.toTagId}
            value={drafts[r.toTagId] ?? r.remark}
            onChange={(e) => setDrafts((d) => ({ ...d, [r.toTagId]: e.target.value }))}
            onBlur={(e) => commit(r, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            disabled={p.busy}
            placeholder="属性名"
            aria-label={`关系属性名: ${tagLabelPlain(r.name)}`}
            className={REMARK_INPUT_CLASS}
          />
          <span
            className="min-w-0 flex-1 truncate px-1 py-1 text-label text-muted"
            onMouseEnter={hoverTitle(relationLabel(r))}
          >
            {'→ ' + tagLabelPlain(r.name)}
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

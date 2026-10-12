/**
 * 关系面板上半「当前关系」列表(自 TagMenuRelationPane 拆出,守 200 行红线):
 * 只负责渲染已读到的出线(`名字 → 目标`,无名字回退目标名)、逐行改名字与「移除」;
 * 读数 / 写库 / 错误都在容器里,传 null 表示读数还没回来(显示加载中,而不是误报空)。
 *
 * 名字存在**点**上(送转 031):行上改名字是改「名字点」(`rename_line_name`),
 * 无名字线上输入名字 = 给这条线取名(`set_tag_relation(from, to, 名字)`)。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import { relationLabel } from '../../shared/tag-relation-facts';
import type { RelationRef } from '../../shared/types';
import { BTN_TEXT } from '../shell/button-classes';

export interface TagMenuRelationListProps {
  /** 当前全部出线;null = 加载中 */
  relations: readonly RelationRef[] | null;
  busy: boolean;
  /** 移除一条线:传线 id(`RelationRef.lineId`)—— 按身份删,与名字框的编辑无关 */
  onRemove: (lineId: number) => void;
  /** 改名字:nameId 非 null = 改名字点;null = 给无名字线取名 */
  onEditName: (toTagId: number, nameId: number | null, next: string) => void;
}

const NAME_INPUT_CLASS =
  'h-7 w-24 shrink-0 rounded-sm border border-border-strong bg-raised px-1.5 text-label text-text outline-none';

/** 一行一名字:同一个目标可有多条不同名字的线,草稿按 (目标, 名字点) 分开存 */
const rowKey = (r: RelationRef): string => `${r.toTagId}\u0000${r.nameId ?? ''}`;

export function TagMenuRelationList(p: TagMenuRelationListProps): ReactNode {
  /** 未提交的草稿:key = 行;读回来的读数变了也不打断正在输入的内容 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const commit = (r: RelationRef, next: string): void => {
    const nameId = r.nameId ?? null;
    const prev = r.nameText ?? '';
    if (nameId !== null) {
      if (next.trim() !== prev) p.onEditName(r.toTagId, nameId, next);
    } else if (next.trim() !== '') {
      p.onEditName(r.toTagId, null, next);
    }
  };

  return (
    <>
      <p className="px-1 text-label text-muted">当前关系</p>
      {p.relations === null && <p className="px-1 py-1 text-label text-muted">加载中…</p>}
      {p.relations !== null && p.relations.length === 0 && (
        <p className="px-1 py-1 text-label text-muted">还没有建立任何关系</p>
      )}
      {p.relations?.map((r) => (
        <div key={rowKey(r)} className="flex items-center gap-1">
          <input
            data-relation-name={r.toTagId}
            data-relation-name-id={r.nameId ?? ''}
            value={drafts[rowKey(r)] ?? r.nameText ?? ''}
            onChange={(e) => setDrafts((d) => ({ ...d, [rowKey(r)]: e.target.value }))}
            onBlur={(e) => commit(r, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            disabled={p.busy}
            placeholder={r.nameText ? '属性名' : '(无名字)'}
            title={'清空只去掉属性名,关系还在;要删掉这条关系请点右侧「移除」'}
            aria-label={`关系名字: ${tagLabelPlain(r.name)}`}
            className={NAME_INPUT_CLASS}
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
            data-relation-remove-name-id={r.nameId ?? ''}
            data-relation-remove-line-id={r.lineId}
            title={'移除关系 ' + tagLabelPlain(r.name)}
            onClick={() => p.onRemove(r.lineId)}
            className={BTN_TEXT + ' text-muted hover:text-danger'}
          >
            移除
          </button>
        </div>
      ))}
    </>
  );
}

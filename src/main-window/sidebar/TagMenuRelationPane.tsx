/**
 * 标签菜单「关系…」面板(标签关系统一 spec §5):上半列出本标签的**全部出边**
 * (`备注 → 目标`,可逐条移除),下半输入框 + 候选列表(复用 `#` 补全那套共享打分/排序引擎
 * `shared/quickpick/model`)。写库走 `setTagRelation` / `removeTagRelation`。
 *
 * 自包含容器:状态与 IPC 都在本文件,TagMenu 只需一行挂载。添加/移除后**保持打开**、
 * 重新读一次出边(读回来的带真实备注,比本地拼更准),不弹 Toast;失败显示后端中文错误。
 */
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { api } from '../../shared/api';
import { buildList, COMPLETE_LIMIT } from '../../shared/quickpick/model';
import type { MruEntry } from '../../shared/quickpick/model';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { remapRanges } from '../../shared/tag-label-highlight';
import { hoverTitle } from '../../shared/truncate-title';
import type { RelationRef, TagCount } from '../../shared/types';
import { TagMenuRelationList } from './TagMenuRelationList';
import { TagMenuRelationCandidates } from './TagMenuRelationCandidates';
import { relationCandidates } from './tag-menu-pure';
import { BTN_GHOST } from './tag-menu-ui';

export interface TagMenuRelationPaneProps {
  /** 本标签(关系起点)id 与完整路径 */
  tagId: number;
  path: string;
  /** 全部标签行(候选池,自身与已建立关系的由 relationCandidates 剔除) */
  rows: readonly TagCount[];
  /** 固定项 / 最近用过(`#` 补全同一套档位;缺省为空档) */
  pinned?: readonly string[];
  mru?: readonly MruEntry[];
  onCancel: () => void;
}

export function TagMenuRelationPane(p: TagMenuRelationPaneProps): ReactNode {
  const [outgoing, setOutgoing] = useState<RelationRef[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  /** 首帧读数未回来:候选池还不知道该排除谁,输入/候选项一律禁用 */
  const loading = outgoing === null;

  const reload = (): Promise<RelationRef[]> => api.listTagRelations(p.tagId);

  useEffect(() => {
    let alive = true;
    reload()
      .then((r) => {
        if (alive) setOutgoing(r);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tagId]);

  const candidates = useMemo(() => {
    const pool = relationCandidates(p.rows, p.path, outgoing ?? []);
    const byPath = new Map(pool.map((c) => [c.path, c.id] as const));
    const { rows } = buildList({
      items: pool.map((c) => ({ id: c.path, label: c.path })),
      query,
      pinned: p.pinned ?? [],
      mru: p.mru ?? [],
      limit: COMPLETE_LIMIT,
    });
    return rows.map((r) => ({
      id: byPath.get(r.item.id) ?? 0,
      path: r.item.id,
      ranges: remapRanges(r.item.id, tagLabelPlain(r.item.id), r.ranges),
    }));
  }, [p.rows, p.path, p.pinned, p.mru, outgoing, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const add = (id: number): void => {
    if (loading) return; // 读数未回来时输入/候选已禁用,这是键盘路径的兜底
    setError('');
    setBusy(true);
    void api
      .setTagRelation(p.tagId, id)
      .then(() => {
        setQuery('');
        return reload();
      })
      .then(setOutgoing)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const remove = (toTagId: number): void => {
    setError('');
    setBusy(true);
    void api
      .removeTagRelation(p.tagId, toTagId)
      .then(reload)
      .then(setOutgoing)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 输入法组合中不误触发
    if (e.key === 'ArrowDown' && candidates.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % candidates.length);
    } else if (e.key === 'ArrowUp' && candidates.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = candidates[activeIndex] ?? candidates[0];
      if (pick !== undefined && !busy) add(pick.id);
    }
  };

  return (
    <div className="p-1">
      <p className="truncate px-1 py-0.5 text-label font-medium text-muted" onMouseEnter={hoverTitle(tagLabelPlain(p.path))}>
        关系:{renderTagLabel(p.path)}
      </p>
      {/* 「当前关系」标题只在 TagMenuRelationList 里渲染一次(容器不再重复) */}
      <TagMenuRelationList relations={outgoing} busy={busy} onRemove={remove} />
      <p className="mt-1 px-1 text-label text-muted">添加关系</p>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError('');
        }}
        onKeyDown={onKeyDown}
        disabled={loading || busy}
        placeholder="输入标签名或路径…"
        aria-label="添加关系标签"
        className="h-8 w-full rounded-sm border border-border-strong bg-raised px-2.5 text-ui text-text outline-none"
      />
      {!loading && candidates.length === 0 && (
        <p className="px-1 py-1 text-label text-muted">
          {query.trim() === '' ? '没有可添加的标签' : '没有匹配的标签'}
        </p>
      )}
      <TagMenuRelationCandidates
        rows={candidates}
        activeIndex={activeIndex}
        busy={busy || loading}
        onHover={setActiveIndex}
        onPick={(c) => add(c.id)}
      />
      {error !== '' && <p className="mt-1 px-1 text-label text-danger">{error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={p.onCancel} className={BTN_GHOST}>
          取消
        </button>
      </div>
    </div>
  );
}

/**
 * 标签菜单第六档「携带…」(spec §6):上半列出本标签当前携带的标签(可逐条移除),
 * 下半输入框 + 候选列表(复用 `#` 补全那套共享打分/排序引擎 `shared/quickpick/model`),
 * 末尾一行只读「被 N 个标签携带」。
 *
 * 自包含容器(与别名面板的 hook + 展示侧拆分不同):状态与 IPC 都在本文件,
 * 这样 TagMenu 只需一行挂载,守住它的 200 行红线(候选列表规模小,不值得再拆一层)。
 * 添加/移除后**保持打开**、就地刷新,不弹 Toast;失败显示后端中文错误。
 */
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { api } from '../../shared/api';
import { buildList, COMPLETE_LIMIT } from '../../shared/quickpick/model';
import type { MruEntry } from '../../shared/quickpick/model';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { remapRanges } from '../../shared/tag-label-highlight';
import { hoverTitle } from '../../shared/truncate-title';
import type { CarryReport, RoleRef, TagCount } from '../../shared/types';
import { TagMenuCarriedList } from './TagMenuCarriedList';
import { TagMenuCarryCandidates } from './TagMenuCarryCandidates';
import { carryCandidates } from './tag-menu-pure';
import { BTN_GHOST } from './tag-menu-ui';

export interface TagMenuCarryPaneProps {
  /** 本标签(携带者)id 与完整路径 */
  tagId: number;
  path: string;
  /** 全部标签行(候选池,自身与已携带的由 carryCandidates 剔除) */
  rows: readonly TagCount[];
  /** 已登记角色(候选只留它们,符合 R3:携带目标必须是角色标签) */
  roles: readonly RoleRef[];
  /** 固定项 / 最近用过(`#` 补全同一套档位;缺省为空档) */
  pinned?: readonly string[];
  mru?: readonly MruEntry[];
  onCancel: () => void;
}

/** 完整路径的升序比较器:相等返回 0(后端的 carried 就是路径序,本地增量插入保持同一口径) */
function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export function TagMenuCarryPane(p: TagMenuCarryPaneProps): ReactNode {
  const [report, setReport] = useState<CarryReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  /** 首帧读数未回来:候选池还不知道该排除谁,输入/候选项一律禁用(否则会选了已携带的、本地又无处可记) */
  const loading = report === null;

  useEffect(() => {
    let alive = true;
    api
      .listTagCarries(p.tagId)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [p.tagId]);

  const candidates = useMemo(() => {
    const roleIds = new Set(p.roles.map((r) => r.tagId));
    const pool = carryCandidates(p.rows, p.path, report?.carried ?? [], roleIds);
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
  }, [p.rows, p.path, p.roles, p.pinned, p.mru, report, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const add = (id: number, path: string): void => {
    if (loading) return; // 读数未回来时输入/候选已禁用,这是键盘路径的兜底
    setError('');
    setBusy(true);
    void api
      .setTagCarry(p.tagId, id)
      .then(() => {
        setQuery('');
        setReport((prev) =>
          prev === null
            ? prev
            : { ...prev, carried: [...prev.carried, { id, path }].sort(byPath) }
        );
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const remove = (id: number): void => {
    setError('');
    setBusy(true);
    void api
      .removeTagCarry(p.tagId, id)
      .then(() =>
        setReport((prev) =>
          prev === null ? prev : { ...prev, carried: prev.carried.filter((c) => c.id !== id) }
        )
      )
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
      if (pick !== undefined && !busy) add(pick.id, pick.path);
    }
  };

  const carriers = report?.carriersOf ?? [];
  const carrierText = carriers.map((c) => tagLabelPlain(c.path)).join('、');

  return (
    <div className="p-1">
      <p className="truncate px-1 py-0.5 text-label font-medium text-muted" onMouseEnter={hoverTitle(tagLabelPlain(p.path))}>
        携带:{renderTagLabel(p.path)}
      </p>
      {/* 「当前携带」标题只在 TagMenuCarriedList 里渲染一次(容器不再重复) */}
      <TagMenuCarriedList carried={report?.carried ?? null} busy={busy} onRemove={remove} />
      <p className="mt-1 px-1 text-label text-muted">添加携带</p>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError('');
        }}
        onKeyDown={onKeyDown}
        disabled={loading || busy}
        placeholder="输入标签名或路径…"
        aria-label="添加携带标签"
        className="h-8 w-full rounded-sm border border-border-strong bg-raised px-2.5 text-ui text-text outline-none"
      />
      {!loading && candidates.length === 0 && (
        <p className="px-1 py-1 text-label text-muted">
          {query.trim() === '' ? '没有可添加的标签' : '没有匹配的标签'}
        </p>
      )}
      <TagMenuCarryCandidates
        rows={candidates}
        activeIndex={activeIndex}
        busy={busy || loading}
        onHover={setActiveIndex}
        onPick={(c) => add(c.id, c.path)}
      />
      <p className="mt-1 truncate px-1 text-label text-muted" onMouseEnter={hoverTitle(carrierText)}>
        被 {carriers.length} 个标签携带{carriers.length > 0 ? ':' + carrierText : ''}
      </p>
      {error !== '' && <p className="mt-1 px-1 text-label text-danger">{error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={p.onCancel} className={BTN_GHOST}>
          取消
        </button>
      </div>
    </div>
  );
}

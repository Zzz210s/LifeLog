// 设置页「标签关系」分区(设计 2026-10-06-tag-relation-design.md §9;规则沿用标签类型建议):
// 把启发式建议逐条过一遍,接受 / 改成别的目标 / 忽略,最后批量建立关系。
// 绝不自动写(R6):只有点「批量确认」才调命令;已建立的关系对应的建议自动消失。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../shared/api';
import type { TagCount } from '../../shared/types';
import { BTN_SECONDARY } from '../shell/button-classes';
import { RelationSuggestionRow } from './RelationSuggestionRow';
import { RelationSuggestionsToolbar } from './RelationSuggestionsToolbar';
import { SettingsSection } from './SettingsSection';
import { TagTreeRelationRow } from './TagTreeRelationRow';
import { SETTINGS_SECTIONS } from './settings-sections';
import { effectiveTarget, pendingSuggestions, planWrites, setExcludedFor, suggestRelations, type RelationSuggestion } from './relation-suggestions';

const META = SETTINGS_SECTIONS.find((s) => s.id === 'relations')!;
/** 每页条数:上百条建议要能一次过完,但一屏不刷太长(R11) */
const PAGE_SIZE = 20;

type ExistingIndex = Map<number, Set<number>>;

export interface RelationSuggestionsSectionProps {
  /** 设置开关「标签树里显示关系」当前值(默认关);透传给 TagTreeRelationRow */
  showRelations?: boolean;
  onShowRelationsChange?: (v: boolean) => void;
}

export function RelationSuggestionsSection(p: RelationSuggestionsSectionProps = {}): ReactNode {
  const [all, setAll] = useState<RelationSuggestion[]>([]);
  const [targets, setTargets] = useState<TagCount[]>([]);
  const [existing, setExisting] = useState<ExistingIndex>(new Map());
  const [ignored, setIgnored] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Map<number, number>>(new Map());
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [filterTarget, setFilterTarget] = useState('all');
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setStatus('');
    api
      .listTags()
      .then(async (tags) => {
        const rows = suggestRelations(tags);
        const ids = [...new Set(rows.map((r) => r.tagId))];
        const edges = await Promise.all(ids.map((id) => api.listTagRelations(id)));
        if (!alive) return;
        setAll(rows);
        setTargets(tags);
        setExisting(new Map(ids.map((id, i) => [id, new Set(edges[i].map((r) => r.toTagId))])));
        setLoaded(true);
      })
      .catch((e) => {
        if (alive) setStatus('读取标签失败: ' + String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(
    () => pendingSuggestions(all, existing, ignored, overrides),
    [all, existing, ignored, overrides],
  );
  const visible = useMemo(
    () => (filterTarget === 'all' ? rows : rows.filter((r) => String(r.toTagId) === filterTarget)),
    [rows, filterTarget],
  );
  const filterOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of rows) if (!seen.has(r.toTagId)) seen.set(r.toTagId, r.toName);
    return [
      { value: 'all', label: '全部关系' },
      ...[...seen].map(([id, name]) => ({ value: String(id), label: name })),
    ];
  }, [rows]);
  const allSelected = useMemo(
    () => new Set(visible.filter((r) => !excluded.has(r.tagId)).map((r) => r.tagId)),
    [visible, excluded],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const toggle = (tagId: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });

  /** 唯一的写库入口:逐条建立关系(set_tag_relation 幂等,不动该标签已有的别的边)。 */
  const confirmBatch = useCallback(async (): Promise<void> => {
    const plan = planWrites(visible, allSelected, overrides);
    if (plan.writes.length === 0) {
      setStatus('没有选中的建议(全选与批量确认只作用于当前筛选可见项)');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      for (const w of plan.writes) await api.setTagRelation(w.fromId, w.toId);
      setExisting((prev) => {
        const next = new Map(prev);
        for (const w of plan.writes) {
          const set = new Set(next.get(w.fromId) ?? []);
          set.add(w.toId);
          next.set(w.fromId, set);
        }
        return next;
      });
      setStatus(`已写入 ${plan.writes.length} 条关系`);
    } catch (e) {
      setStatus('写入失败: ' + String(e));
    } finally {
      setBusy(false);
    }
  }, [visible, allSelected, overrides]);

  return (
    <SettingsSection meta={META}>
      <p className="border-b border-border py-3 text-label text-muted">
        建议只看标签在树里的路径,是启发式、不是语义判断;确认前不会写入任何数据。
        全选与批量确认只作用于当前筛选出来的可见条目。
      </p>
      <TagTreeRelationRow
        checked={p.showRelations === true}
        onChange={(v) => p.onShowRelationsChange?.(v)}
      />
      <RelationSuggestionsToolbar
        filterTarget={filterTarget}
        filterOptions={filterOptions}
        onFilterTarget={setFilterTarget}
        selectedCount={allSelected.size}
        busy={busy}
        onSelectAll={() => setExcluded((prev) => setExcludedFor(prev, visible.map((r) => r.tagId), false))}
        onSelectNone={() => setExcluded((prev) => setExcludedFor(prev, visible.map((r) => r.tagId), true))}
        onConfirm={() => void confirmBatch()}
      />

      {!loaded && status === '' && <p className="py-3 text-label text-muted">正在读取标签…</p>}
      {status !== '' && (
        <p role="status" className="py-2 text-label text-muted">
          {status}
        </p>
      )}
      {loaded && rows.length === 0 && (
        <p className="py-3 text-label text-muted">没有待确认的建议(已建立过关系的不会再出现)。</p>
      )}

      {pageRows.map((row) => (
        <RelationSuggestionRow
          key={row.tagId}
          row={row}
          targets={targets}
          checked={!excluded.has(row.tagId)}
          toId={effectiveTarget(row, overrides)}
          onToggle={() => toggle(row.tagId)}
          onTarget={(id) => setOverrides((prev) => new Map(prev).set(row.tagId, id))}
          onIgnore={() => setIgnored((prev) => new Set(prev).add(row.tagId))}
        />
      ))}

      <div className="flex items-center justify-between gap-2 border-t border-border py-3 text-label text-muted">
        <span>
          共 {visible.length} 条 · 第 {current + 1}/{pageCount} 页
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="上一页"
            className={BTN_SECONDARY}
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </button>
          <button
            type="button"
            aria-label="下一页"
            className={BTN_SECONDARY}
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}

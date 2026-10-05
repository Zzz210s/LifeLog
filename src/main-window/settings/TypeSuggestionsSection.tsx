// 设置页「标签类型」分区(设计 2026-10-05-tag-types-design.md §6):把启发式建议逐条过一遍,
// 接受 / 改成别的类型 / 忽略,最后批量写库。
// 绝不自动写(R6/R10):只有点「批量确认」才调命令;已确认的 (标签,类型) 自动消失。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../shared/api';
import type { TypeRef } from '../../shared/types';
import { BTN_SECONDARY } from '../shell/button-classes';
import { TypeSuggestionRow } from './TypeSuggestionRow';
import { TypeSuggestionsToolbar } from './TypeSuggestionsToolbar';
import { SettingsSection } from './SettingsSection';
import { TagTreeCarryRow } from './TagTreeCarryRow';
import { SETTINGS_SECTIONS } from './settings-sections';
import { effectiveType, pendingSuggestions, planWrites, setExcludedFor, suggestTypes, type TypeSuggestion } from './type-suggestions';

const META = SETTINGS_SECTIONS.find((s) => s.id === 'types')!;
/** 每页条数:上百条建议要能一次过完,但一屏不刷太长(R11) */
const PAGE_SIZE = 20;

type ClaimIndex = Map<number, Set<number>>;

export interface TypeSuggestionsSectionProps {
  /** 设置开关「标签树里显示携带」当前值(默认关);透传给 TagTreeCarryRow */
  showCarry?: boolean;
  onShowCarryChange?: (v: boolean) => void;
}

export function TypeSuggestionsSection(p: TypeSuggestionsSectionProps = {}): ReactNode {
  const [all, setAll] = useState<TypeSuggestion[]>([]);
  const [types, setTypes] = useState<TypeRef[]>([]);
  const [claimed, setClaimed] = useState<ClaimIndex>(new Map());
  const [ignored, setIgnored] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Map<number, number>>(new Map());
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [filterType, setFilterType] = useState('all');
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setStatus('');
    Promise.all([api.listTags(), api.listTypes()])
      .then(async ([tags, typeList]) => {
        const rows = suggestTypes(tags);
        const ids = [...new Set(rows.map((r) => r.tagId))];
        const claims = await Promise.all(ids.map((id) => api.listTagTypes(id)));
        if (!alive) return;
        setAll(rows);
        setTypes(typeList);
        setClaimed(new Map(ids.map((id, i) => [id, new Set(claims[i].map((r) => r.tagId))])));
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
    () => pendingSuggestions(all, claimed, ignored, overrides),
    [all, claimed, ignored, overrides],
  );
  const visible = useMemo(
    () => (filterType === 'all' ? rows : rows.filter((r) => String(r.typeTagId) === filterType)),
    [rows, filterType],
  );
  const filterOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of rows) if (!seen.has(r.typeTagId)) seen.set(r.typeTagId, r.typeName);
    return [
      { value: 'all', label: '全部类型' },
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

  /** 唯一的写库入口:先登记缺的类型标签(幂等),再逐标签整体替换认领;作用域 = 当前筛选可见项 */
  const confirmBatch = useCallback(async (): Promise<void> => {
    const plan = planWrites(visible, allSelected, overrides, claimed, new Set(types.map((r) => r.tagId)));
    if (plan.writes.length === 0) {
      setStatus('没有选中的建议(全选与批量确认只作用于当前筛选可见项)');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      for (const id of plan.registerTypeIds) await api.setTagTypeFlag(id, true);
      for (const w of plan.writes) await api.setTagTypes(w.tagId, w.typeIds);
      setClaimed((prev) => {
        const next = new Map(prev);
        for (const w of plan.writes) next.set(w.tagId, new Set(w.typeIds));
        return next;
      });
      // 新登记的类型要立刻进「改成别的类型」下拉,否则同批剩下的行看不到它
      const fresh = await api.listTypes().catch(() => null);
      if (fresh !== null) setTypes(fresh);
      setStatus(`已写入 ${plan.writes.length} 条认领`);
    } catch (e) {
      setStatus('写入失败: ' + String(e));
    } finally {
      setBusy(false);
    }
  }, [visible, allSelected, overrides, claimed, types]);

  return (
    <SettingsSection meta={META}>
      <p className="border-b border-border py-3 text-label text-muted">
        建议只看标签在树里的路径,是启发式、不是语义判断;确认前不会写入任何数据。
        全选与批量确认只作用于当前筛选出来的可见条目。
      </p>
      <TagTreeCarryRow
        checked={p.showCarry === true}
        onChange={(v) => p.onShowCarryChange?.(v)}
      />
      <TypeSuggestionsToolbar
        filterType={filterType}
        filterOptions={filterOptions}
        onFilterType={setFilterType}
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
        <p className="py-3 text-label text-muted">没有待确认的建议(已确认过的不会再出现)。</p>
      )}

      {pageRows.map((row) => (
        <TypeSuggestionRow
          key={row.tagId}
          row={row}
          types={types}
          checked={!excluded.has(row.tagId)}
          typeId={effectiveType(row, overrides)}
          onToggle={() => toggle(row.tagId)}
          onType={(id) => setOverrides((prev) => new Map(prev).set(row.tagId, id))}
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

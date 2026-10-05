// 设置页「标签角色」分区(设计 2026-10-05-tag-roles-design.md §6):把启发式建议逐条过一遍,
// 接受 / 改成别的角色 / 忽略,最后批量写库。
// 绝不自动写(R6/R10):只有点「批量确认」才调命令;已确认的 (标签,角色) 自动消失。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../shared/api';
import type { RoleRef } from '../../shared/types';
import { BTN_SECONDARY } from '../shell/button-classes';
import { SelectInput } from './controls';
import { RoleSuggestionRow } from './RoleSuggestionRow';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_SECTIONS } from './settings-sections';
import { effectiveRole, pendingSuggestions, planWrites, suggestRoles, type RoleSuggestion } from './role-suggestions';

const META = SETTINGS_SECTIONS.find((s) => s.id === 'roles')!;
/** 每页条数:上百条建议要能一次过完,但一屏不刷太长(R11) */
const PAGE_SIZE = 20;

type ClaimIndex = Map<number, Set<number>>;

export function RoleSuggestionsSection(): ReactNode {
  const [all, setAll] = useState<RoleSuggestion[]>([]);
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [claimed, setClaimed] = useState<ClaimIndex>(new Map());
  const [ignored, setIgnored] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Map<number, number>>(new Map());
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [filterRole, setFilterRole] = useState('all');
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setStatus('');
    Promise.all([api.listTags(), api.listRoles()])
      .then(async ([tags, roleList]) => {
        const rows = suggestRoles(tags);
        const ids = [...new Set(rows.map((r) => r.tagId))];
        const claims = await Promise.all(ids.map((id) => api.listTagRoles(id)));
        if (!alive) return;
        setAll(rows);
        setRoles(roleList);
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
    () => (filterRole === 'all' ? rows : rows.filter((r) => String(r.roleTagId) === filterRole)),
    [rows, filterRole],
  );
  const filterOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of rows) if (!seen.has(r.roleTagId)) seen.set(r.roleTagId, r.roleName);
    return [
      { value: 'all', label: '全部角色' },
      ...[...seen].map(([id, name]) => ({ value: String(id), label: name })),
    ];
  }, [rows]);
  const allSelected = useMemo(
    () => new Set(rows.filter((r) => !excluded.has(r.tagId)).map((r) => r.tagId)),
    [rows, excluded],
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

  /** 唯一的写库入口:先登记缺的角色标签(幂等),再逐标签整体替换认领 */
  const confirmBatch = useCallback(async (): Promise<void> => {
    const plan = planWrites(rows, allSelected, overrides, claimed, new Set(roles.map((r) => r.tagId)));
    if (plan.writes.length === 0) {
      setStatus('没有选中的建议');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      for (const id of plan.registerRoleIds) await api.registerRole(id);
      for (const w of plan.writes) await api.setTagRoles(w.tagId, w.roleIds);
      setClaimed((prev) => {
        const next = new Map(prev);
        for (const w of plan.writes) next.set(w.tagId, new Set(w.roleIds));
        return next;
      });
      setStatus(`已写入 ${plan.writes.length} 条认领`);
    } catch (e) {
      setStatus('写入失败: ' + String(e));
    } finally {
      setBusy(false);
    }
  }, [rows, allSelected, overrides, claimed, roles]);

  return (
    <SettingsSection meta={META}>
      <p className="border-b border-border py-3 text-label text-muted">
        建议只看标签在树里的路径,是启发式、不是语义判断;确认前不会写入任何数据。
      </p>
      <div className="flex flex-wrap items-center gap-2 border-b border-border py-3">
        <SelectInput
          value={filterRole}
          label="按建议角色筛选"
          options={filterOptions}
          onChange={setFilterRole}
        />
        <button type="button" aria-label="全选" className={BTN_SECONDARY} onClick={() => setExcluded(new Set())}>
          全选
        </button>
        <button
          type="button"
          aria-label="全不选"
          className={BTN_SECONDARY}
          onClick={() => setExcluded(new Set(rows.map((r) => r.tagId)))}
        >
          全不选
        </button>
        <button
          type="button"
          aria-label="批量确认"
          className={BTN_SECONDARY}
          disabled={busy}
          onClick={() => void confirmBatch()}
        >
          {`批量确认(${allSelected.size})`}
        </button>
      </div>

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
        <RoleSuggestionRow
          key={row.tagId}
          row={row}
          roles={roles}
          checked={!excluded.has(row.tagId)}
          roleId={effectiveRole(row, overrides)}
          onToggle={() => toggle(row.tagId)}
          onRole={(id) => setOverrides((prev) => new Map(prev).set(row.tagId, id))}
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

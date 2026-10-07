/**
 * 分组信息流状态机(设计 §6.4):骨架给组顺序+总数,首屏一次取每组前 20 条,
 * 组内续页 offset 只数本组(折叠别的组不影响);折叠态只存会话内,degraded/slow 交调用方处理。
 * 条件值(filterKey)变化 -> 整组重查 + 折叠态重置。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { api } from '../../shared/api';
import type { Note } from '../../shared/types';
import { filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { normalizeFilter } from '../../shared/filter-conditions-normalize';
import { groupSessionKey } from '../filter/group-by';
import type { ErrorKind } from '../shell/ErrorBar';
import { mergeNotes } from '../stream/notes-list';

/** 一个渲染用组:骨架元信息 + 已加载笔记(组内顺序由后端 sorts 给出) */
export interface NoteGroup {
  /** 组键 = 一级子标签路径;null = 无该轴标签的哨兵组(恒最后) */
  key: string | null;
  sessionKey: string;
  /** 组名(末段名;哨兵组为 `（无 轴末段名）`,由后端给) */
  label: string;
  count: number;
  notes: Note[];
  hasMore: boolean;
}

export interface GroupedNotes {
  /** groupBy 非空(进入分组模式;degraded 期间也为真,由调用方决定是否渲染平铺) */
  enabled: boolean;
  groups: NoteGroup[];
  allNotes: Note[];
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (sessionKey: string) => void;
  loadMoreGroup: (sessionKey: string) => void;
  /** 正在续页的组(串行一次一组) */
  loadingGroup: string | null;
  /** 组数超上限 -> 退化为平铺并提示;/ 骨架过慢 -> 仍分组只提示 */
  degraded: boolean;
  slow: boolean;
  loading: boolean;
  queryFailed: boolean;
  /** 整组重查(编辑/删除需要重查时用) */
  reload: () => Promise<void>;
  /** 编辑流就地更新适配:把平铺 updater 的结果按 id 写回各组 */
  setNotes: Dispatch<SetStateAction<Note[]>>;
}

export function useGroupedNotes(
  conditions: FilterConditions,
  setError: (kind: ErrorKind, message: string) => void,
  clearError: (kind: ErrorKind) => void
): GroupedNotes {
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [degraded, setDegraded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null);
  const [queryFailed, setQueryFailed] = useState(false);
  const seq = useRef(0); // 过期响应丢弃(快速切分组/条件竞态);续页用同一代号判祖先是否被作废

  const key = filterKey(conditions);
  const current = useMemo(() => normalizeFilter(conditions), [key]);
  const enabled = current.groupBy !== null;

  /** 整组重查:骨架 -> (未降级时)每组首屏 */
  const load = useCallback(async () => {
    if (!enabled) {
      setGroups([]);
      setDegraded(false);
      setSlow(false);
      setQueryFailed(false);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    try {
      const skel = await api.groupSkeleton(current);
      if (id !== seq.current) return;
      setSlow(skel.slow);
      if (skel.degraded) {
        // 组数过多:不发分组查询(可能很重),由调用方用平铺列表兜底
        setDegraded(true);
        setGroups([]);
        setQueryFailed(false);
        clearError('query');
        return;
      }
      setDegraded(false);
      const pages = await api.queryGrouped(current);
      if (id !== seq.current) return;
      const byKey = new Map(pages.map((p) => [groupSessionKey(p.key), p.notes]));
      setGroups(
        skel.groups.map((g) => {
          const notes = byKey.get(groupSessionKey(g.key)) ?? [];
          return {
            key: g.key,
            sessionKey: groupSessionKey(g.key),
            label: g.label,
            count: g.count,
            notes,
            hasMore: notes.length < g.count,
          };
        })
      );
      setQueryFailed(false);
      clearError('query');
    } catch (e) {
      if (id !== seq.current) return;
      setError('query', '加载笔记失败: ' + String(e));
      setQueryFailed(true);
      setGroups([]);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [current, enabled, setError, clearError]);

  // 条件值变(含分组轴/方向):整组重查 + 折叠态重置(新条件 = 新结果集,折叠键可能失效)
  useEffect(() => {
    setCollapsed(new Set());
    void load();
  }, [load]);

  const groupsRef = useRef<NoteGroup[]>([]);
  groupsRef.current = groups;
  const loadingRef = useRef<string | null>(null);
  loadingRef.current = loadingGroup;

  const toggleCollapsed = useCallback((k: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  /** 组内续页:offset = 本组已加载条数(与别的组无关) */
  const loadMoreGroup = useCallback(
    (k: string) => {
      const g = groupsRef.current.find((x) => x.sessionKey === k);
      if (g === undefined || !g.hasMore || loadingRef.current !== null) return;
      const gen = seq.current;
      setLoadingGroup(k);
      void api
        .queryGroupPage(current, g.key, g.notes.length)
        .then((page) => {
          if (gen !== seq.current) return;
          setGroups((prev) =>
            prev.map((x) => {
              if (x.sessionKey !== k) return x;
              const notes = mergeNotes(x.notes, page);
              return { ...x, notes, hasMore: notes.length < x.count };
            })
          );
        })
        .catch((e) => {
          if (gen === seq.current) setError('query', '加载更多失败: ' + String(e));
        })
        .finally(() => {
          if (gen === seq.current) setLoadingGroup(null);
        });
    },
    [current, setError]
  );

  const allNotes = useMemo(() => groups.flatMap((g) => g.notes), [groups]);

  /** 编辑流的就地更新适配:updater 作用于「已加载的全部组内笔记」,结果按 id 写回各组 */
  const setNotes = useCallback<Dispatch<SetStateAction<Note[]>>>((updater) => {
    setGroups((prev) => {
      const all = prev.flatMap((g) => g.notes);
      const updated = typeof updater === 'function' ? updater(all) : updater;
      const byId = new Map(updated.map((n) => [n.id, n]));
      return prev.map((g) => ({
        ...g,
        notes: g.notes.map((n) => byId.get(n.id)).filter((n): n is Note => n !== undefined),
      }));
    });
  }, []);

  return {
    enabled,
    groups,
    allNotes,
    collapsed,
    toggleCollapsed,
    loadMoreGroup,
    loadingGroup,
    degraded,
    slow,
    loading,
    queryFailed,
    reload: load,
    setNotes,
  };
}

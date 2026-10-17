/**
 * 批量选择会话状态(spec 2026-10-17 §2/§3):批量态**不落库** —— 切筛选或 Esc 即退出并清选中。
 *
 * 状态与选择在这里;四个写动作的编排在 `use-batch-writes`(加 / 去标签 / 删除),
 * 导出在 `use-batch-export`,纯逻辑在 `batch-mode`。加 / 去标签 / 导出**不清选中**(便于连续操作),
 * 删除清掉本次删掉的 id(否则计数虚高)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import { addIds, containsAll, removeIds, toggleId } from './batch-mode';
import { writeAddTag, writeDelete, writeRemoveTag } from './use-batch-writes';

/** 回执停留时长(比导出回执的 2 秒长:批量文案更长,给够读的时间) */
const NOTICE_MS = 5000;

export interface BatchApi {
  on: boolean;
  selected: ReadonlySet<number>;
  notice: string | null;
  /** 有 IPC 在途:动作按钮禁用,避免连点出双份写 */
  busy: boolean;
  /** 本页(当前渲染的 notes)是否已全选 */
  pageAll: boolean;
  /** 筛选结果是否已全部选中 */
  filterAll: boolean;
  /** 已知的筛选命中总数(null = 还没拉过) */
  filterTotal: number | null;
  toggleOn: () => void;
  toggle: (id: number) => void;
  selectPage: () => void;
  selectAll: () => void;
  cancel: () => void;
  addTag: (target: number, label: string) => void;
  removeTag: (target: number, label: string) => void;
  removeSelected: () => void;
  /** 其它动作(导出)复用同一条回执通道 */
  notify: (text: string) => void;
}

export function useBatchSelection(o: {
  conditions: FilterConditions;
  notes: Note[];
  refresh: () => unknown;
}): BatchApi {
  const { conditions, notes, refresh } = o;
  const [on, setOn] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cache, setCache] = useState<{ key: string; ids: number[] } | null>(null);
  const key = filterKey(conditions);

  // 回执 5 秒自消;连续动作时后一条覆盖前一条(定时器只留一个)
  const timer = useRef<number | null>(null);
  const notify = useCallback((text: string) => {
    setNotice(text);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  // 切筛选即退出批量并清选中(§2.2):旧选中在新条件下可能已不可见
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setOn(false);
    setSelected(new Set());
    setCache(null);
  }, [key]);

  // Esc 退批量:优先级低于预览卡片 —— 卡片还在 DOM 里说明它先吃这一下(一次 Esc 只做一件事)
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[data-testid="tag-preview-card"]') !== null) return;
      setOn(false);
      setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);

  const pageIds = useMemo(() => notes.map((n) => n.id), [notes]);
  const fresh = cache !== null && cache.key === key ? cache.ids : null;
  const pageAll = containsAll(selected, pageIds);
  const filterAll = fresh !== null && containsAll(selected, fresh);

  const toggleOn = useCallback(() => {
    setOn((v) => !v);
    setSelected(new Set());
  }, []);
  const cancel = useCallback(() => {
    setOn(false);
    setSelected(new Set());
  }, []);
  const toggle = useCallback((id: number) => setSelected((s) => toggleId(s, id)), []);

  const selectPage = useCallback(() => {
    setSelected((s) => (containsAll(s, pageIds) ? removeIds(s, pageIds) : addIds(s, pageIds)));
  }, [pageIds]);

  /** 首次按当前筛选拉全 id(缓存按 filterKey);已缓存则只在"全选 / 取消"之间切 */
  const selectAll = useCallback(() => {
    if (fresh !== null) {
      setSelected((s) => (containsAll(s, fresh) ? new Set() : addIds(s, fresh)));
      return;
    }
    void api
      .filterPointIds(conditions)
      .then((ids) => {
        setCache({ key, ids });
        setSelected((s) => addIds(s, ids));
        if (ids.length === 0) notify('当前筛选没有命中条目');
      })
      .catch((e) => notify('取筛选结果失败：' + String(e)));
  }, [conditions, fresh, key, notify]);

  const dropIds = useCallback((ids: number[]) => setSelected((s) => removeIds(s, ids)), []);

  /** 三个写动作共用的外壳:空选给回执、在途置 busy */
  const withIds = useCallback(
    (fn: (ids: number[], io: { notify: typeof notify; refresh: () => unknown; dropIds: typeof dropIds }) => Promise<void>) => {
      const ids = [...selected];
      if (ids.length === 0) return notify('先选中条目');
      setBusy(true);
      void fn(ids, { notify, refresh, dropIds }).finally(() => setBusy(false));
    },
    [dropIds, notify, refresh, selected]
  );

  const addTag = useCallback(
    (target: number, label: string) => withIds((ids, io) => writeAddTag(ids, target, label, io)),
    [withIds]
  );
  const removeTag = useCallback(
    (target: number, label: string) => withIds((ids, io) => writeRemoveTag(ids, target, label, io)),
    [withIds]
  );
  const removeSelected = useCallback(
    () => withIds((ids, io) => writeDelete(ids, io)),
    [withIds]
  );

  return {
    on,
    selected,
    notice,
    busy,
    pageAll,
    filterAll,
    filterTotal: fresh === null ? null : fresh.length,
    toggleOn,
    toggle,
    selectPage,
    selectAll,
    cancel,
    addTag,
    removeTag,
    removeSelected,
    notify,
  };
}

/** 批量态缺席时的占位(StreamView 的默认值):全 no-op、on=false。
 *  测试夹具与只读用法不必自己造一份完整 BatchApi。 */
export const OFF_BATCH: BatchApi = {
  on: false,
  selected: new Set<number>(),
  notice: null,
  busy: false,
  pageAll: false,
  filterAll: false,
  filterTotal: null,
  toggleOn: () => {},
  toggle: () => {},
  selectPage: () => {},
  selectAll: () => {},
  cancel: () => {},
  addTag: () => {},
  removeTag: () => {},
  removeSelected: () => {},
  notify: () => {},
};

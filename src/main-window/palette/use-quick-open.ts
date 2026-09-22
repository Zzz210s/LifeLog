/**
 * 快速打开的落地接线(设计 §3.3):Enter 后滚到流中高亮;不在当前筛选结果里时
 * 清掉筛选再定位(并给中文提示),清完仍找不到才报「不在当前筛选结果中」。
 *
 * "清了筛选等新一轮结果"这一步不能靠一轮 effect 就下结论:清筛选那一刻 `notes` 还是旧列表,
 * 而重查是异步的。所以记住**当时的列表引用**,等它换过一次再看结果;期间 `loading` 为真就继续等。
 */
import { useCallback, useEffect, useRef } from 'react';
import { isFilterEmpty } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import type { ErrorKind } from '../shell/ErrorBar';
import { QUICK_OPEN_CLEARED_TEXT, QUICK_OPEN_MISSING_TEXT, locatePlan, scrollToNote } from './quick-open';

export interface QuickOpenOptions {
  notes: readonly Note[];
  /** 新一轮查询是否在飞(清筛选后要等它落地再判缺失) */
  loading: boolean;
  conditions: FilterConditions;
  clearFilters: () => void;
  setError: (kind: ErrorKind, message: string) => void;
  /** 定位根(默认 document;测试可注入) */
  root?: ParentNode;
}

export function useQuickOpen(options: QuickOpenOptions): (noteId: number) => void {
  const latest = useRef(options);
  latest.current = options;
  /** 待定位:记录清筛选那一刻的列表引用,等它换掉再判 */
  const pending = useRef<{ id: number; seen: readonly Note[] } | null>(null);

  const openNote = useCallback((noteId: number) => {
    const { notes, clearFilters, setError, root } = latest.current;
    const plan = locatePlan(notes, noteId, isFilterEmpty(latest.current.conditions));
    if (plan === 'found') {
      if (!scrollToNote(root ?? document, noteId)) setError('action', QUICK_OPEN_MISSING_TEXT);
      return;
    }
    if (plan === 'clear-filters') {
      pending.current = { id: noteId, seen: notes };
      clearFilters();
      setError('action', QUICK_OPEN_CLEARED_TEXT);
      return;
    }
    setError('action', QUICK_OPEN_MISSING_TEXT);
  }, []);

  useEffect(() => {
    const p = pending.current;
    if (p === null || options.notes === p.seen) return;
    if (options.notes.some((n) => n.id === p.id)) {
      pending.current = null;
      if (!scrollToNote(options.root ?? document, p.id)) options.setError('action', QUICK_OPEN_MISSING_TEXT);
      return;
    }
    if (options.loading) return; // 新一轮查询还在飞
    pending.current = null;
    options.setError('action', QUICK_OPEN_MISSING_TEXT);
  }, [options.notes, options.loading, options.root, options.setError]);

  return openNote;
}

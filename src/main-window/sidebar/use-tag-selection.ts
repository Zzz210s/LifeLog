/**
 * 侧栏多选(2026-10-25 用户要求:Ctrl+A 区域全选、Shift 点击连选、Ctrl 点击加选)。
 *
 * 为什么做成**显式模式**而不是直接占用修饰键:今天的 Ctrl / Alt / Shift 三格在侧栏分别是
 * 「AND 追加筛选 / 排除 / 只看这一条」,是日常整理的主力手势(设计 2026-10-16 §4)。
 * 直接改语义会把这些习惯一次性打翻,所以多选只在**打开模式后**接管:
 * 关闭时一切照旧;打开后单击 = 切换、Shift = 从锚点连选、Ctrl = 切换、Ctrl+A = 全选可见行。
 *
 * 选中集以**路径**为键(与筛选条件、MRU 一致);重命名后路径变,选中项自然失效(不追)。
 * 选中集不落库:这是会话内的操作态,和批量条目那边同一口径。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface TagSelectionApi {
  /** 多选模式是否打开(头部图标 aria-pressed) */
  active: boolean;
  selected: ReadonlySet<string>;
  count: number;
  setActive: (on: boolean) => void;
  /** 单击行:切换该行(同时把锚点移到它) */
  toggle: (path: string) => void;
  /** Shift+单击:Ctrl+单击语义之外,从锚点到该行按**可见顺序**连选 */
  rangeTo: (path: string, visible: readonly string[]) => void;
  /** Ctrl+A:全选当前可见行;再按一次清空 */
  selectAll: (visible: readonly string[]) => void;
  clear: () => void;
}

/** 事件是否落在可编辑控件里(此时 Ctrl+A 归输入框自己) */
function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el?.isContentEditable);
}

export function useTagSelection(visible: readonly string[]): TagSelectionApi {
  const [active, setActiveRaw] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // 锚点:上一次"无修饰键点击"的行,Shift 连选从这里起
  const anchor = useRef<string | null>(null);

  const setActive = useCallback((on: boolean) => {
    setActiveRaw(on);
    if (!on) {
      setSelected(new Set());
      anchor.current = null;
    }
  }, []);

  const toggle = useCallback((path: string) => {
    anchor.current = path;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const rangeTo = useCallback((path: string, order: readonly string[]) => {
    const from = anchor.current;
    if (from === null) {
      anchor.current = path;
      setSelected(new Set([path]));
      return;
    }
    const a = order.indexOf(from);
    const b = order.indexOf(path);
    if (a < 0 || b < 0) {
      anchor.current = path;
      setSelected(new Set([path]));
      return;
    }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    setSelected(new Set(order.slice(lo, hi + 1)));
    // 锚点不动:连续 Shift 点击时区间始终从同一起点伸缩(与资源管理器一致)
  }, []);

  const selectAll = useCallback((order: readonly string[]) => {
    setSelected((prev) => (prev.size >= order.length && order.length > 0 ? new Set() : new Set(order)));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  // 键盘:Esc = 退出并清空;Ctrl+A = 全选可见行(焦点在输入控件里时不拦)
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // 多选态优先吃这一下:否则同一次 Esc 会把预览卡片一起关掉(两处语义打架)
        e.preventDefault();
        e.stopPropagation();
        setActive(false);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'a' || e.key === 'A') && !inEditable(e.target)) {
        e.preventDefault();
        selectAll(visibleRef.current);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, selectAll, setActive]);

  const count = selected.size;
  return useMemo(
    () => ({ active, selected, count, setActive, toggle, rangeTo, selectAll, clear }),
    [active, selected, count, setActive, toggle, rangeTo, selectAll, clear]
  );
}

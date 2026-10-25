/**
 * 侧栏多选(2026-10-25 第二版:按 VS Code 资源管理器的口径重写)。
 *
 * 第一版做成了"先点图标进多选模式 + 每行一个勾选框",用户否掉了:**不要勾选框**,
 * 要 VS Code 那种「行高亮 + 修饰键」的选择。所以这一版没有模式、没有勾选框:
 *
 * - 单击 = 选择这一行(**单选**,替换整个选择集),同时照旧执行原有动作(筛选 / 只看);
 * - Ctrl+单击 = 加选 / 减选(不动筛选条件);
 * - Shift+单击 = 从锚点连选到这一行(按**可见顺序**,折叠的子树不在区间内);
 * - Ctrl+A = 全选可见行(焦点在输入控件里时不拦);再按一次清空;
 * - Esc = 清空选择;
 * - 选中的行用 `bg-selected` 高亮(与"已被筛选命中"的 `bg-accent-soft` 不是同一档,
 *   两个状态可以同时存在且分得清 —— 这正是 VS Code 里"当前行 vs 已选中"的做法)。
 *
 * 选择集以**路径**为键(与筛选条件、MRU 同源);选中不落库,是会话内操作态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface TagSelectionApi {
  selected: ReadonlySet<string>;
  count: number;
  /** 单击:替换为仅这一行(并把锚点移到它) */
  selectOnly: (path: string) => void;
  /** Ctrl+单击:加选 / 减选 */
  toggle: (path: string) => void;
  /** Shift+单击:从锚点到该行的区间(锚点不动,连续 Shift 是伸缩) */
  rangeTo: (path: string) => void;
  /** Ctrl+A:全选可见行;已全选则清空 */
  selectAll: () => void;
  clear: () => void;
}

/** 事件是否落在可编辑控件里(此时 Ctrl+A / 方向键归控件自己) */
function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el?.isContentEditable);
}

export function useTagSelection(visible: readonly string[]): TagSelectionApi {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // 锚点 = 上一次"单击 / Ctrl+单击"的行;Shift 连选从这里起
  const anchor = useRef<string | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const selectOnly = useCallback((path: string) => {
    anchor.current = path;
    setSelected(new Set([path]));
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

  const rangeTo = useCallback((path: string) => {
    const order = visibleRef.current;
    const from = anchor.current;
    const a = from === null ? -1 : order.indexOf(from);
    const b = order.indexOf(path);
    if (b < 0) return;
    if (a < 0) {
      // 还没有锚点(刚打开应用就按 Shift):把这一行当锚点,只选它
      anchor.current = path;
      setSelected(new Set([path]));
      return;
    }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    setSelected(new Set(order.slice(lo, hi + 1)));
    // 锚点不动:连续 Shift 点击时区间始终从同一起点伸缩(与资源管理器一致)
  }, []);

  const selectAll = useCallback(() => {
    const order = visibleRef.current;
    setSelected((prev) => (order.length > 0 && prev.size >= order.length ? new Set() : new Set(order)));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'a' || e.key === 'A') && !inEditable(e.target)) {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === 'Escape' && selected.size > 0 && !inEditable(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        clear();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectAll, clear, selected.size]);

  // 选中行被删 / 被改名后路径不在可见集里:从选择集里摘掉,不留悬空的"已选 1"
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(visible);
      const next = new Set([...prev].filter((p) => alive.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const count = selected.size;
  return useMemo(
    () => ({ selected, count, selectOnly, toggle, rangeTo, selectAll, clear }),
    [selected, count, selectOnly, toggle, rangeTo, selectAll, clear]
  );
}

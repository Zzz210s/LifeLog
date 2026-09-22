/**
 * 浮层状态机:打开/关闭 + 键盘 + 焦点归位(设计 §3.1/§3.8)。
 * 候选(items)由调用方注入(T5 用假数据,T6 才接真 provider);列表投影走纯函数 buildList。
 * `e.repeat` 一律忽略 —— 按住方向键/回车不能反复触发(T3 审查 Minor 8)。
 * 键盘监听挂在 **window**(面板打开期间),不是输入框:点面板非行区域后焦点落到 body 时
 * Esc/Tab/方向键/Enter 仍要生效(审查 Important 1)。
 * 应用内快捷键的监听与读取在 `use-palette-hotkeys.ts`(同目录,避免本文件超 150 行)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { buildList } from '../../shared/quickpick/model';
import type { ListRow, MruEntry, QuickPickItem } from '../../shared/quickpick/model';

/** PageUp/PageDown 的跨页步长(设计未给值:渲染上限 200,取 10 便于扫读) */
export const PAGE_STEP = 10;

export interface UsePaletteOptions {
  /** 候选(注入:T5 假数据,T6 由 provider 产出) */
  items: readonly QuickPickItem[];
  pinned?: readonly string[];
  mru?: readonly MruEntry[];
  limit?: number;
  /** 接受:keepOpen = true 即 Alt+Enter(执行但不关闭浮层) */
  onAccept?: (row: ListRow, keepOpen: boolean) => void;
}

export interface PaletteController {
  isOpen: boolean;
  /** 前缀('' 笔记 / '>' 命令 / '#' 标签);T6 按输入实时驱动 */
  prefix: string;
  query: string;
  rows: readonly ListRow[];
  total: number;
  truncated: boolean;
  activeIndex: number;
  inputRef: RefObject<HTMLInputElement | null>;
  open: (prefix?: string) => void;
  close: () => void;
  setQuery: (next: string) => void;
  setActiveIndex: (index: number) => void;
  accept: (index: number, keepOpen: boolean) => void;
  /** 原生 keydown 处理(面板打开时由本 hook 挂到 window;输入框不再单独接 React onKeyDown) */
  handleKeyDown: (event: KeyboardEvent) => void;
}

/** 边界循环取模(上下方向键与翻页共用;total 为 0 时恒 0) */
export function wrapIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

export function usePalette(options: UsePaletteOptions): PaletteController {
  const { items, pinned, mru, limit, onAccept } = options;
  const [isOpen, setIsOpen] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [query, setQueryState] = useState('');
  const [rawActive, setRawActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const list = useMemo(
    () => buildList({ items, query, pinned, mru, limit }),
    [items, query, pinned, mru, limit],
  );
  const rows = list.rows;
  // 候选变化后夹紧当前行:过滤掉了正在高亮的那行也不能停在空行上
  const activeIndex = rows.length === 0 ? 0 : Math.min(rawActive, rows.length - 1);

  // 打开时聚焦输入框(浮层只在打开这一刻抢焦点,关闭时归还)
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQueryState('');
    setRawActive(0);
    const target = restoreRef.current;
    restoreRef.current = null;
    // 归位条件(审查 M3/M4):焦点仍在浮层输入框、目标已入文档,才交还;命令自己把焦点
    // 移走(含 blur 到 body)时不抢回,目标已被卸载时也不调用 focus(无声 no-op)。
    const active = document.activeElement;
    const inside = active === null || active === inputRef.current;
    if (target !== null && inside && target.isConnected) target.focus();
  }, []);

  const open = useCallback((nextPrefix = '') => {
    const active = document.activeElement;
    restoreRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setPrefix(nextPrefix);
    setQueryState('');
    setRawActive(0);
    setIsOpen(true);
  }, []);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setRawActive(0); // 输入变化即回到第一行
  }, []);

  const accept = useCallback(
    (index: number, keepOpen: boolean) => {
      const row = rows[index];
      if (row === undefined) return; // 空态提示项不可执行
      onAccept?.(row, keepOpen);
      if (!keepOpen) close();
    },
    [rows, onAccept, close],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.repeat) return;
      const total = rows.length;
      const move = (delta: number): void => {
        event.preventDefault();
        setRawActive((current) => wrapIndex(current, delta, total));
      };
      switch (event.key) {
        case 'ArrowDown': return move(1);
        case 'ArrowUp': return move(-1);
        case 'PageDown': return move(PAGE_STEP);
        case 'PageUp': return move(-PAGE_STEP);
        case 'Home': event.preventDefault(); return setRawActive(0);
        case 'End': event.preventDefault(); if (total > 0) setRawActive(total - 1); return;
        case 'Enter': event.preventDefault(); return accept(activeIndex, event.altKey);
        case 'Escape': return close();
        case 'Tab': event.preventDefault(); return close(); // Tab 关闭并把焦点交回打开前元素
        default: return;
      }
    },
    [rows.length, activeIndex, accept, close],
  );

  // 面板打开期间把键盘监听到 window:焦点是否在输入框上都生效(审查 Important 1)
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  return {
    isOpen, prefix, query, rows, total: list.total, truncated: list.truncated, activeIndex,
    inputRef, open, close, setQuery, setActiveIndex: setRawActive, accept, handleKeyDown,
  };
}


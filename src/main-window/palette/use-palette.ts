/**
 * 浮层状态机:打开/关闭 + 键盘 + 焦点归位 + 浮层外关闭(设计 §3.1/§3.8)。
 * 候选(items)由调用方注入(T5 用假数据,T6 才接真 provider);列表投影走纯函数 buildList。
 * `e.repeat` 一律忽略 —— 按住方向键/回车不能反复触发(T3 审查 Minor 8)。
 * 键盘监听挂在 **window**(面板打开期间),不是输入框:点面板非行区域后焦点落到 body 时
 * Esc/Tab/方向键/Enter 仍要生效(审查 Important 1)。代价是也会收到主窗其它控件的按键,
 * 故先按「输入法组合 + 事件目标 + 修饰键」过滤(审查 N1/N4,判定在 `palette-target.ts`)。
 * 监听身份用 ref 稳住,effect 只在开关时重跑(审查 N5);浮层外 mousedown 关闭浮层
 * (审查交接清单 4,与 T6 的「点区块外即保存」共用 data-floating 判定)。
 * 应用内快捷键的监听与读取在 `use-palette-hotkeys.ts`(同目录,避免本文件超 150 行)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { buildList } from '../../shared/quickpick/model';
import type { ListRow, MruEntry, QuickPickItem } from '../../shared/quickpick/model';
import { isInsidePalette, shouldIgnoreKey } from './palette-target';
import { resolveKeyAction, wrapIndex } from './palette-keydown';
import { restoreFocus } from './palette-restore';

/** 边界循环取模(上下方向键与翻页共用;total 为 0 时恒 0)—— 实现在 palette-keydown.ts */
export { wrapIndex } from './palette-keydown';

export interface UsePaletteOptions {
  /** 候选(注入:T5 假数据,T6 由 provider 产出) */
  items: readonly QuickPickItem[];
  pinned?: readonly string[];
  mru?: readonly MruEntry[];
  limit?: number;
  /** 接受:keepOpen = true 即 Alt+Enter(执行但不关闭浮层) */
  onAccept?: (row: ListRow, keepOpen: boolean) => void;
  /**
   * 归位锚点(T6 注入):打开前元素已卸载 / 无 activeElement 时退到它(主区容器,
   * 须 `tabIndex={-1}` 才可聚焦)。不注入时退化为「不抢焦点」(审查 N2/N3)。
   */
  anchorRef?: RefObject<HTMLElement | null>;
  /**
   * 前缀实时驱动(T6):输入变化时把原始输入切成(前缀, query);返回 null 表示"按当前前缀处理"。
   * 不注入时前缀只由 `open(prefix)` 决定(T5 行为不变)。
   */
  splitPrefix?: (raw: string) => { prefix: string; query: string } | null;
  /**
   * 过滤条件变化回调(T6):host 据此取候选。用回调而不是让 host 读 controller 的字段 ——
   * host 还要把候选传回 `items`,直读会形成数据环(取候选需要 prefix/query,而 prefix/query 在 hook 里)。
   */
  onFilterChange?: (state: { open: boolean; prefix: string; query: string }) => void;
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
  /** 直接切前缀(前缀实时驱动与「打开即带前缀」共用同一入口) */
  setPrefix: (next: string) => void;
  setActiveIndex: (index: number) => void;
  accept: (index: number, keepOpen: boolean) => void;
  /** 原生 keydown 处理(面板打开时由本 hook 挂到 window;输入框不再单独接 React onKeyDown) */
  handleKeyDown: (event: KeyboardEvent) => void;
}

/** 边界循环取模的再导出由 palette-keydown.ts 提供(保持既有 import 路径不破) */

export function usePalette(options: UsePaletteOptions): PaletteController {
  const { items, pinned, mru, limit, onAccept, anchorRef, splitPrefix, onFilterChange } = options;
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

  // 过滤条件上报(T6 取候选用):变化即通知,回调身份由 host 用稳定函数传(useState 的 setter 本身稳定)
  useEffect(() => {
    onFilterChange?.({ open: isOpen, prefix, query });
  }, [onFilterChange, isOpen, prefix, query]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQueryState('');
    setRawActive(0);
    const target = restoreRef.current;
    restoreRef.current = null;
    // 归位顺序与"不抢回"边界都在 palette-restore.ts(自本文件抽出以守行数红线)
    restoreFocus({ restore: target, input: inputRef.current, anchor: anchorRef?.current ?? null });
  }, [anchorRef]);

  const open = useCallback((nextPrefix = '') => {
    const active = document.activeElement;
    restoreRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setPrefix(nextPrefix);
    setQueryState('');
    setRawActive(0);
    setIsOpen(true);
  }, []);

  const setQuery = useCallback(
    (next: string) => {
      // 前缀实时驱动:输入里的 `>` / `#` 当场切 provider(不注入时前缀不动,T5 行为不变)
      const split = splitPrefix?.(next) ?? null;
      if (split === null) setQueryState(next);
      else {
        setPrefix(split.prefix);
        setQueryState(split.query);
      }
      setRawActive(0); // 输入变化即回到第一行
    },
    [splitPrefix],
  );

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
      // 输入法组合中不抢键(审查 N1;照 InputBar.tsx:82 先例):组合中的 Esc 会关浮层、
      // Enter 上屏会同时接受高亮行;keyCode 229 是只给 keyCode 的 IME 形态。
      if (event.isComposing || event.keyCode === 229) return;
      // 目标在浮层之外且是可编辑元素(Composer/编辑面板):那不是给浮层的输入(审查 N4),
      // 除 Esc 外一律不处理,否则光标键被吞、Enter 双动作。
      if (shouldIgnoreKey(event)) return;
      const action = resolveKeyAction(event);
      if (action.type === 'ignore') return;
      if (action.type !== 'close' || action.preventDefault) event.preventDefault();
      const total = rows.length;
      if (action.type === 'move') setRawActive((current) => wrapIndex(current, action.delta, total));
      else if (action.type === 'set') setRawActive(action.index < 0 ? Math.max(0, total - 1) : 0);
      else if (action.type === 'accept') accept(activeIndex, action.keepOpen);
      else close();
    },
    [rows.length, activeIndex, accept, close],
  );

  // 监听身份必须稳定:handleKeyDown 依赖 rows/activeIndex/accept,每次按键都会换新函数,
  // 直接进 effect 依赖会「每按键 remove+add」(审查 N5;无泄漏但有 churn)。用 ref 取最新实现。
  const latestKey = useRef(handleKeyDown);
  latestKey.current = handleKeyDown;
  const onWindowKeyDown = useCallback((event: KeyboardEvent) => latestKey.current(event), []);

  // 面板打开期间把键盘监听到 window:焦点是否在输入框上都生效(审查 Important 1)
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [isOpen, onWindowKeyDown]);

  // 浮层外 mousedown 关闭浮层(审查交接清单 4):浮层内点击不关(T6 的「点区块外即保存」
  // 用同一 data-floating 判定跳过浮层内点击),浮层外按下即关。
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (event: MouseEvent): void => {
      if (!isInsidePalette(event.target)) close();
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [isOpen, close]);

  return {
    isOpen, prefix, query, rows, total: list.total, truncated: list.truncated, activeIndex,
    inputRef, open, close, setQuery, setPrefix, setActiveIndex: setRawActive, accept, handleKeyDown,
  };
}


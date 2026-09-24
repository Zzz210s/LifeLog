/**
 * 候选列表状态机(自浮层状态机收窄,2026-09-24 计划 2/3 Task 5)。
 *
 * 浮层外壳已随统一输入框删除:生产里只剩「统一输入框常驻驱动 -> 列表投影 -> 下拉高亮」这条链,
 * 所以本 hook 只保留 输入/前缀 -> (prefix, query) -> buildList 的行 + 高亮行夹紧。
 * 打开/关闭、窗口级 keydown、浮层外 mousedown 关闭、`close()` 的焦点归位都已删除
 * (生产不可达,原实现见 1/3 的浮层状态机)。候选(items)由调用方注入,投影走纯函数 buildList。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildList } from '../../shared/quickpick/model';
import type { ListRow, MruEntry, QuickPickItem } from '../../shared/quickpick/model';

export interface UsePaletteOptions {
  /** 候选(由 useAppPalette 的 provider 体系取回) */
  items: readonly QuickPickItem[];
  pinned?: readonly string[];
  mru?: readonly MruEntry[];
  limit?: number;
  /**
   * 前缀实时驱动:输入变化时把原始输入切成(前缀, query);返回 null 表示"按当前前缀处理"。
   */
  splitPrefix?: (raw: string) => { prefix: string; query: string } | null;
  /**
   * 过滤条件变化回调:host 据此取候选。用回调而不是让 host 读 controller 的字段 ——
   * host 还要把候选传回 `items`,直读会形成数据环(取候选需要 prefix/query,而它们在 hook 里)。
   */
  onFilterChange?: (state: { prefix: string; query: string }) => void;
}

/** 下拉需要的字段:视图只读行/计数/高亮,驱动只走 setQuery / setPrefix / setActiveIndex */
export interface PaletteController {
  /** 前缀('' 笔记 / '>' 命令 / '#' 标签 / '@' 打开笔记);按输入实时驱动 */
  prefix: string;
  /** 前缀之后的查询 */
  query: string;
  rows: readonly ListRow[];
  total: number;
  truncated: boolean;
  /** 高亮行(已被 rows 长度夹紧) */
  activeIndex: number;
  setQuery: (next: string) => void;
  /** 直接切前缀(前缀实时驱动与「打开即带前缀」共用同一入口) */
  setPrefix: (next: string) => void;
  setActiveIndex: (index: number) => void;
}

export function usePalette(options: UsePaletteOptions): PaletteController {
  const { items, pinned, mru, limit, splitPrefix, onFilterChange } = options;
  const [prefix, setPrefix] = useState('');
  const [query, setQueryState] = useState('');
  const [rawActive, setRawActive] = useState(0);

  const list = useMemo(
    () => buildList({ items, query, pinned, mru, limit }),
    [items, query, pinned, mru, limit],
  );
  const rows = list.rows;
  // 候选变化后夹紧当前行:过滤掉了正在高亮的那行也不能停在空行上
  const activeIndex = rows.length === 0 ? 0 : Math.min(rawActive, rows.length - 1);

  // 过滤条件上报(host 取候选用):变化即通知,回调身份由 host 用稳定函数传
  useEffect(() => {
    onFilterChange?.({ prefix, query });
  }, [onFilterChange, prefix, query]);

  const setQuery = useCallback(
    (next: string) => {
      // 前缀实时驱动:输入里的 `>` / `#` / `@` 当场切 provider(不注入时前缀不动)
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

  return {
    prefix,
    query,
    rows,
    total: list.total,
    truncated: list.truncated,
    activeIndex,
    setQuery,
    setPrefix,
    setActiveIndex: setRawActive,
  };
}

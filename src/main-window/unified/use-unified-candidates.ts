/**
 * 统一输入框的候选(计划 Task 5):把输入框的 `(mode, query)` **常驻**推进候选控制器的候选态,
 * 再把控制器里的列表原样投影给下拉。
 *
 * 为什么不在这里自己取候选:候选池(`createNoteCandidates`/`createTagCandidates`)、行装饰、
 * MRU 与"旧回包丢弃"的序号守卫都已经接在 `useAppPalette`(`providers` + `useProviderItems`)里,
 * 复制一份就会多出第二个 matcher/候选池。本文件只做两件事:
 *  1) **驱动**:`note` / `filter` 没有下拉(清掉前缀,停掉后台取候选),其余三类把
 *     `前缀 + query` 写进控制器 —— 控制器里的 `splitPrefix` 会照注册表把它重新切成
 *     (前缀, query),于是复用同一套 provider 解析。
 *  2) **投影**:三类前缀返回控制器的 `rows/total/truncated`,其余返回空列表。
 *
 * 候选池作废(`refreshKey`)与取回失败的出口都发生在 `useAppPalette` 那一侧(取候选就发生在那里),
 * 本 hook 只驱动 + 投影,不接受也不需要这两个参数。
 */
import { useEffect, useRef } from 'react';
import type { InputMode } from '../../shared/input-prefix';
import type { ListRow } from '../../shared/quickpick/model';
import type { RowDecoration } from '../palette/PaletteRow';
import type { PaletteController } from '../palette/use-palette';

/** mode -> 注册表前缀;`null` = 这个模式没有候选下拉(记录模式 D6 / 实时筛选模式 §4) */
export const PREFIX_FOR_MODE: Readonly<Record<InputMode, string | null>> = {
  note: null,
  filter: null,
  tag: '#',
  command: '>',
  open: '@',
};

export interface UnifiedCandidateOptions {
  mode: InputMode;
  /** 前缀之后的查询(已按 input-prefix 剥掉前缀与紧邻空格) */
  query: string;
  /** 候选控制器(宿主没接时为 null:本 hook 退化为空列表,不驱动) */
  controller: PaletteController | null;
}

export interface UnifiedCandidates {
  rows: readonly ListRow[];
  total: number;
  truncated: boolean;
}

/** 宿主一次给全的候选接线(统一输入框只透传,不自己拼散字段) */
export interface UnifiedCandidateWiring {
  /** 候选控制器:候选/高亮状态的唯一宿主 */
  palette: PaletteController;
  /** 行装饰(命令快捷键/标签计数/笔记日期),按行 id 索引 */
  decorations?: Readonly<Record<string, RowDecoration>>;
}

const EMPTY: UnifiedCandidates = { rows: [], total: 0, truncated: false };

export function useUnifiedCandidates(o: UnifiedCandidateOptions): UnifiedCandidates {
  const prefix = PREFIX_FOR_MODE[o.mode];
  const controller = o.controller;
  // 控制器对象每次渲染都是新的(usePalette 返回字面量),方法身份才稳定(useCallback):
  // 用 ref 取最新一份。
  const latest = useRef(controller);
  latest.current = controller;
  // 驱动去重:上游 setter 的身份不保证稳定(usePalette 的 setQuery 依赖 splitPrefix),
  // 凡渲染都可能重跑 effect —— 不去重就会把高亮行一遍遍按回第一行。
  const driven = useRef<string | null>(null);

  useEffect(() => {
    const ctl = latest.current;
    if (ctl === null) return;
    const key = (prefix ?? '') + '\u0000' + o.query;
    if (driven.current === key) return;
    driven.current = key;
    if (prefix === null) ctl.setPrefix('');
    else ctl.setQuery(prefix + o.query);
  }, [prefix, o.query]);

  if (prefix === null || controller === null) return EMPTY;
  return { rows: controller.rows, total: controller.total, truncated: controller.truncated };
}

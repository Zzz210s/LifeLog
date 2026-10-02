/**
 * `[[` 补全在统一输入框里的接线(设计 N2–N5):触发判断 -> 笔记标题候选池 -> 键盘/采纳。
 *
 * 触发**不是**前缀(可以出现在正文任何位置),所以不走 `PREFIXES` 注册表:由 `detectLinkTrigger`
 * 判断光标上下文,命中时本 hook 自建一份候选态(候选池 = 全库笔记标题),复用 `buildList` 的
 * 打分/排序/高亮与 `#` 补全同一套,并按 `PaletteController` 形状交给面板,互不影响既有四类前缀。
 *
 * 候选池懒取:`useNoteTitles(enabled)` 只在真的出现未闭合 `[[` 后才打一次 IPC(N9 的会话内缓存)。
 * 空查询给整池前 8(id 升序,`buildList` 默认序);有查询按 `scoreFuzzy` 精排。
 */
import { useEffect, useMemo, useState } from 'react';
import { acceptLink, detectLinkTrigger } from '../../shared/note-link-trigger';
import { buildList, COMPLETE_LIMIT } from '../../shared/quickpick/model';
import type { QuickPickItem } from '../../shared/quickpick/model';
import type { NoteTitle } from '../../shared/types';
import { clampActiveIndex } from '../palette/palette-limits';
import type { PaletteController } from '../palette/use-palette';
import { useNoteTitles } from '../data/use-note-titles';

/** 笔记标题 -> 候选项;`excludeId` 是「正在编辑的这一条自己」(N3) */
export function linkItems(titles: readonly NoteTitle[], excludeId?: number): QuickPickItem[] {
  const out: QuickPickItem[] = [];
  for (const t of titles) {
    if (t.id === excludeId) continue;
    out.push({ id: String(t.id), label: t.title });
  }
  return out;
}

export interface LinkCompleteOptions {
  raw: string;
  /** 光标位置(由输入域的上报更新) */
  caret: number;
  /** 笔记数据版本(候选池的作废键) */
  dataVersion: number;
  /** 正在编辑的那一条(候选里排除它) */
  excludeId?: number;
}

export interface LinkComplete {
  /** 当前是否该显示链接候选(未闭合 `[[` 且没被 Esc 收起) */
  active: boolean;
  controller: PaletteController;
  /** 采纳第 index 行:给出替换后的正文与光标;行不存在返回 null */
  accept(index: number): { text: string; caret: number } | null;
  /** Esc 收起面板(不动正文);正文再变一次即自然重现 */
  dismiss(): void;
}

export function useLinkComplete(o: LinkCompleteOptions): LinkComplete {
  const trigger = detectLinkTrigger(o.raw, o.caret);
  const pool = useNoteTitles(o.dataVersion, trigger !== null);
  const items = useMemo(() => linkItems(pool.titles, o.excludeId), [pool.titles, o.excludeId]);
  const query = trigger?.query ?? '';
  const list = useMemo(() => buildList({ items, query, limit: COMPLETE_LIMIT }), [items, query]);

  const [rawActive, setRawActive] = useState(0);
  // 查询一变就回到第一行(与控制器 setQuery 同口径),否则收窄后高亮可能停在空行
  useEffect(() => { setRawActive(0); }, [query]);
  const activeIndex = clampActiveIndex(rawActive, list.rows.length);

  // Esc 收起:记住「在哪段正文上收的」,正文一变(继续打字/删字)就重现
  const [mutedOn, setMutedOn] = useState<string | null>(null);

  return {
    active: trigger !== null && mutedOn !== o.raw,
    controller: {
      prefix: '[[',
      query,
      rows: list.rows,
      total: list.total,
      truncated: list.truncated,
      activeIndex,
      setQuery: () => {},
      setPrefix: () => {},
      setActiveIndex: setRawActive,
    },
    accept(index) {
      const row = list.rows[index];
      if (row === undefined) return null;
      const next = acceptLink(o.raw, o.caret, row.item.label);
      return next.text === o.raw && next.caret === o.caret ? null : next;
    },
    dismiss() {
      setMutedOn(o.raw);
    },
  };
}

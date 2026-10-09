/**
 * `[[` 补全在统一输入框里的接线(设计 N2–N5):触发判断 -> 笔记标题候选池 -> 键盘/采纳。
 *
 * 触发**不是**前缀(可以出现在正文任何位置),所以不走 `PREFIXES` 注册表:由 `detectLinkTrigger`
 * 判断光标上下文,命中时本 hook 自建一份候选态(候选池 = 全库笔记标题),复用 `buildList` 的
 * 打分/排序/高亮与 `#` 补全同一套,并按 `PaletteController` 形状交给面板,互不影响既有四类前缀。
 *
 * 候选池懒取:`useEntityPool(enabled)` 只在真的出现未闭合 `[[` 后才打一次 IPC(N9 的会话内缓存)。
 * 池是**全部实体**(计划 T3.2):树内实体带路径,采纳仍写入显示首行(`[[X]]` 按名字寻址)。
 * 空查询:MRU(最近用过)优先,其后按池顺序;有查询按 `scoreFuzzy` 精排(MRU 不参与)。
 */
import { useEffect, useMemo, useState } from 'react';
import { acceptLink, detectLinkTrigger } from '../../shared/note-link-trigger';
import type { NoteMruSource } from '../../shared/note-mru';
import type { EntityCandidate } from '../../shared/entity-pool';
import { buildList, COMPLETE_LIMIT } from '../../shared/quickpick/model';
import type { QuickPickItem } from '../../shared/quickpick/model';
import { clampActiveIndex } from '../palette/palette-limits';
import type { PaletteController } from '../palette/use-palette';
import { useEntityPool } from '../data/use-entity-pool';

/** 实体 -> 候选项(显示首行;`excludeId` 是「正在编辑的这一条自己」,N3) */
export function linkItems(pool: readonly EntityCandidate[], excludeId?: number): QuickPickItem[] {
  const out: QuickPickItem[] = [];
  for (const e of pool) {
    if (e.id === excludeId) continue;
    out.push({ id: String(e.id), label: e.name });
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
  /** 笔记 MRU(采纳记账 + 空查询排序;与主窗/输入栏共用一份,见 shared/note-mru) */
  mru?: NoteMruSource | null;
}

export interface LinkComplete {
  /** 当前是否该显示链接候选(未闭合 `[[` 且没被 Esc 收起) */
  active: boolean;
  controller: PaletteController;
  /** 采纳第 index 行:给出替换后的正文与光标;行不存在返回 null */
  accept(index: number): { text: string; caret: number } | null;
  /** Esc 收起面板(不动正文);正文再变一次即自然重现 */
  dismiss(): void;
  /** 采纳记账(供编辑器走 DOM 写回那条路复用):id 进 MRU 并触发空查询重排 */
  touchMru(id: string): void;
}

export function useLinkComplete(o: LinkCompleteOptions): LinkComplete {
  const trigger = detectLinkTrigger(o.raw, o.caret);
  const pool = useEntityPool(o.dataVersion, trigger !== null);
  const items = useMemo(() => linkItems(pool.pool, o.excludeId), [pool.pool, o.excludeId]);
  const query = trigger?.query ?? '';
  // 采纳记一次 MRU 后要让空查询重排:用 tick 现读 entries(),不缓存成 props 里的静态数组
  const [mruTick, setMruTick] = useState(0);
  const mru = useMemo(() => o.mru?.entries() ?? [], [o.mru, mruTick]);
  const list = useMemo(
    () => buildList({ items, query, limit: COMPLETE_LIMIT, mru }),
    [items, query, mru],
  );

  const [rawActive, setRawActive] = useState(0);
  // 查询一变就回到第一行(与控制器 setQuery 同口径),否则收窄后高亮可能停在空行
  useEffect(() => { setRawActive(0); }, [query]);
  const activeIndex = clampActiveIndex(rawActive, list.rows.length);

  // Esc 收起:记住「在哪段正文上收的」,正文一变(继续打字/删字)就重现
  const [mutedOn, setMutedOn] = useState<string | null>(null);

  /** 采纳记账:进 MRU + 让空查询按最近用过重排(编辑器自己写 DOM 的采纳路径也走这里) */
  const touchMru = (id: string): void => {
    o.mru?.touch(id);
    setMruTick((t) => t + 1);
  };

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
      touchMru(row.item.id);
      return next.text === o.raw && next.caret === o.caret ? null : next;
    },
    dismiss() {
      setMutedOn(o.raw);
    },
    touchMru,
  };
}

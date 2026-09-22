/**
 * 浮层设置的解析与消毒(设计 §5;T4 复审判 N1/N2 的收口点)。
 *
 * 设置值来自 KV 表的字符串,可能被手改/损坏,一律"读不坏":坏 JSON = 没设置,
 * 非法条目逐条丢弃。**MRU 注入与 limit 注入都必须先过这里** —— 模型层对非有限 count
 * 与 -Infinity limit 的行为不友好(NaN/Infinity 会抢占「最近」档首位 / -Infinity 回退 200),
 * 保护责任在 T6 的注入侧(T4 复审判:N1 非有限/负 count 不得进列表、N2 limit 永远落在可用区间)。
 */
import type { MruEntry } from '../../shared/quickpick/model';

/** 设置键(设计 §5;命名空间 ui.*) */
export const PALETTE_SETTING_KEYS = Object.freeze({
  /** 命令 MRU(JSON 数组,`[{id,count}]`) */
  mruCommands: 'ui.mru.commands',
  /** 笔记 MRU(同上) */
  mruNotes: 'ui.mru.notes',
  /** 输入栏固定标签(路径数组) */
  pinnedTags: 'ui.pinned.tags',
  /** 浮层渲染上限 */
  limit: 'ui.palette.limit',
} as const);

/** 浮层渲染上限默认值(= 设计 §3.3 的 QUICK_OPEN_LIMIT) */
export const PALETTE_LIMIT_DEFAULT = 200;

/** 坏 JSON 一律当"没设置"(抄 commandsQuickAccess 的容错,不让坏数据把浮层搞挂) */
export function parseJsonLoose(text: string | null | undefined): unknown {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * MRU 条目消毒:只留「非空 id + 正有限整数 count」;非数组/对象一律空表。
 * 重复 id 取最大次数(与 `quickpick/model.ts` 的归并口径一致)。
 */
export function sanitizeMruEntries(raw: unknown): MruEntry[] {
  if (!Array.isArray(raw)) return [];
  const best = new Map<string, number>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, count } = entry as { id?: unknown; count?: unknown };
    if (typeof id !== 'string' || id.trim() === '') continue;
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
    best.set(id, Math.max(best.get(id) ?? 0, Math.floor(count)));
  }
  return [...best.entries()].map(([id, count]) => ({ id, count }));
}

/** 固定标签路径:数组里只留非空字符串(去重、保持首现顺序) */
export function parsePinnedTags(text: string | null | undefined): string[] {
  const raw = parseJsonLoose(text);
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * limit 消毒:合法值是 ≥1 的整数(小数向下取整);其余(缺失/NaN/±Infinity/0/负数)
 * 一律回缺省上限 —— 坏设置只会让列表回到默认长度,绝不会变成"永远 0 项"的空浮层(N2)。
 */
export function sanitizeLimit(raw: number | string | null | undefined): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return PALETTE_LIMIT_DEFAULT;
  return Math.max(1, Math.floor(n));
}

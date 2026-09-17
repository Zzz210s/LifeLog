/**
 * 笔记流的时间显示(纯函数,spec 2026-09-17 D6):
 * 时间只显示物理列 `created_at`,格式 `MM-DD HH:MM`;不再有"点日期改期"的交互,
 * 也没有从时间标签派生的日期。取值口径与 Rust 侧一致(库内 localtime)。
 * **跨年不得歧义**:库内已有 2023-2026 的笔记,`01-02` 会分不清哪年 ——
 * 非当前年显示 `YYYY-MM-DD`(仍然不带秒),当前年才用紧凑的 `MM-DD HH:MM`。
 */

export type TimeDisplayKind = 'same-year' | 'other-year' | 'invalid';

/** 判定展示口径(纯函数,便于单测):now 与 createdAt 同年 -> 紧凑,不同年 -> 带年 */
export function timeDisplayKind(createdAt: string, now: Date = new Date()): TimeDisplayKind {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(createdAt.trim());
  if (m === null) return 'invalid';
  return Number(m[1]) === now.getFullYear() ? 'same-year' : 'other-year';
}

/** `YYYY-MM-DD HH:MM[:SS]` -> `MM-DD HH:MM`(同年)或 `YYYY-MM-DD`(跨年);不认识的值返回空串 */
export function formatNoteTime(createdAt: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(createdAt.trim());
  if (m === null) return '';
  return timeDisplayKind(createdAt, now) === 'other-year'
    ? `${m[1]}-${m[2]}-${m[3]}`
    : `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

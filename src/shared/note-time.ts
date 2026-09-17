/**
 * 笔记流的时间显示(纯函数,spec 2026-09-17 D6):
 * 时间只显示物理列 `created_at`,格式 `MM-DD HH:MM`;不再有"点日期改期"的交互,
 * 也没有从时间标签派生的日期。取值口径与 Rust 侧一致(库内 localtime)。
 */

/** `YYYY-MM-DD HH:MM[:SS]` -> `MM-DD HH:MM`;空值或不认识的值返回空串(界面据此不渲染) */
export function formatNoteTime(createdAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(createdAt.trim());
  return m === null ? '' : `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

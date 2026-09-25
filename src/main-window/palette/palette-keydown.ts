/**
 * 边界循环取模(唯一导出)。
 *
 * 自 `use-palette.ts` 抽出以守行数红线;浮层外壳与它的按键映射(`resolveKeyAction`/`PAGE_STEP`)
 * 已随统一输入框删除 —— 生产里只剩统一输入框的键盘路由在用这一条(`unified/unified-keys.ts`)。
 */

/** 边界循环取模(上下方向键共用;total 为 0 时恒 0) */
export function wrapIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

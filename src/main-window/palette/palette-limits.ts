/**
 * 候选列表的渲染与高亮上限(唯一真源)。
 *
 * 下拉只画前 MAX_RENDER_ROWS 行(行 id 到 unified-opt-<MAX-1>),所以**高亮也必须夹在这里**:
 * 否则空 query 的 `@`(200 条候选)按一下 ↑ 就把高亮推到第 199 行,DOM 里没有那一行
 * -> aria-activedescendant 悬空、视觉上"没有一行是高亮的"。
 */
export const MAX_RENDER_ROWS = 90;

/** 把高亮夹进"既在候选范围内、又在渲染范围内"的区间(空列表回 0) */
export function clampActiveIndex(raw: number, rowCount: number): number {
  const max = Math.min(rowCount, MAX_RENDER_ROWS) - 1;
  if (max < 0) return 0;
  return Math.max(0, Math.min(raw, max));
}

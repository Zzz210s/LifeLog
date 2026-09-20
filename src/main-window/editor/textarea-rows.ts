/** 就地源码编辑框的行数:按源码行数推导,钳制在 4..24,避免短笔记留大白、长笔记看不全 */
export const MIN_EDIT_ROWS = 4;
export const MAX_EDIT_ROWS = 24;

export function editRows(source: string): number {
  const lines = source.split('\n').length;
  return Math.min(MAX_EDIT_ROWS, Math.max(MIN_EDIT_ROWS, lines));
}

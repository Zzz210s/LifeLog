/**
 * 编辑面板的标签数提示(spec 2026-09-20 §5.4 / D11):
 * 纯显示层建议 —— 不改保存行为、不阻断保存、不做任何校验。
 */
export const TAG_COUNT_HINT_MAX = 5;

/** 标签数文案 */
export function tagCountLabel(n: number): string {
  return `标签 ${n} 个`;
}

/** 超过 5 个时给灰色建议,否则无提示(返回 null 由调用方决定不渲染) */
export function tagCountHint(n: number): string | null {
  return n > TAG_COUNT_HINT_MAX ? '建议 3-5 个' : null;
}

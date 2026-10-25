/**
 * 主窗「快捷搜索栏」(统一输入框)的行高设置(2026-10-17 用户要求):
 * 原来写死 `h-8`(32 CSS px)+ `text-ui`(13px),单行显得过窄、字偏小;改成可调,
 * **默认 36** —— 与 Edge 地址栏(omnibox)的内容高度同一口径:Edge 那个控件本身 32px,
 * 上下各留 2px 呼吸,取 36。用户嫌小时往 44 拨,嫌大时往 28 拨。
 *
 * 单位一律 CSS px;真实写入窗口的是主窗 DOM 高度,不涉及输入栏那套逻辑像素换算。
 * 行高与字号是**同一档**:只调行高不调字号会出现「一行字孤零零挂在中间」的观感。
 */
export const SEARCH_ROW_HEIGHT_KEY = 'ui.search_row_height';
/** 默认 = Edge 地址栏口径(见文件头) */
export const SEARCH_ROW_HEIGHT_DEFAULT = 36;
export const SEARCH_ROW_HEIGHT_MIN = 28;
export const SEARCH_ROW_HEIGHT_MAX = 56;
export const SEARCH_ROW_HEIGHT_STEP = 2;
/** 输入域的上下内边距合计(py-1.5 = 6 + 6),行高 = 行高设置 − 这个值 */
const PADDING_Y = 12;

/** 读数归一:非数值/越界一律钳到区间,读不到时调用方给默认值 */
export function normalizeSearchRowHeight(raw: unknown): number {
  // `Number(null) === 0`、`Number('') === 0` 会把"没存过"误读成"拨到最小"，所以先挡空值
  if (raw === null || raw === undefined || raw === '') return SEARCH_ROW_HEIGHT_DEFAULT;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return SEARCH_ROW_HEIGHT_DEFAULT;
  const clamped = Math.min(SEARCH_ROW_HEIGHT_MAX, Math.max(SEARCH_ROW_HEIGHT_MIN, n));
  // 步长对齐(滑块与数字框都按 STEP 走,避免存进 37 这种滑块拨不出来的值)
  return Math.round(clamped / SEARCH_ROW_HEIGHT_STEP) * SEARCH_ROW_HEIGHT_STEP;
}

/** 本行的 line-height(px):内容盒高度 —— 让空输入恰好等于设置的行高 */
export function searchLineHeight(rowHeight: number): number {
  return normalizeSearchRowHeight(rowHeight) - PADDING_Y;
}

/**
 * 字号档:行高越大字越大(四档)。**不改 text-ui/text-sm 的令牌体系**,
 * 只是在这里挑现成的语义类,免得再造一套字号。
 */
export function searchFontClass(rowHeight: number): string {
  const h = normalizeSearchRowHeight(rowHeight);
  if (h <= 32) return 'text-ui';
  if (h <= 40) return 'text-sm';
  if (h <= 48) return 'text-base';
  return 'text-lg';
}

// 颜色数学的取值口径:只认 6 位十六进制(可带 #、大小写不敏感、先 trim)。
// 3 位缩写 / 8 位带 alpha / 命名色 / 空串一律 null —— 不猜、不补全,让调用方回退默认值。

export type Hex = `#${string}`;
export type Rgb = { r: number; g: number; b: number };

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

export function normalizeHex(raw: string | null): Hex | null {
  if (raw === null) return null;
  const matched = HEX_RE.exec(raw.trim());
  if (!matched) return null;
  return `#${matched[1].toLowerCase()}` as Hex;
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (normalized === null) return null;
  const value = Number.parseInt(normalized.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/** 单通道线性化(WCAG 2.x 分段线性) */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度 0-1;非法输入 -> 0 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (rgb === null) return 0;
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

/** WCAG 对比度 1-21;任一非法输入 -> 1 */
export function contrastRatio(a: string, b: string): number {
  if (hexToRgb(a) === null || hexToRgb(b) === null) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 两种墨色取对比度高者(分界 L≈0.179),对任意底色都 ≥4.5:1 */
export function pickTextInk(bg: string): '#000000' | '#ffffff' {
  return contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000';
}

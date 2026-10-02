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

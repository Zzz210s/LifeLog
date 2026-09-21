// 滚动测量用的 PNG 解码与 WCAG 对比度小件(零依赖:Node 自带 zlib 解 IDAT)。
// 为什么自己解:滚动条那一列只占十几个像素,必须逐像素取色;而 CDP 只能给 base64 PNG,
// 装 sharp/canvas 这类依赖只为取几十个像素不划算。
import zlib from 'node:zlib';

/** 解码 8 位 PNG(支持 color type 2 RGB / 6 RGBA,非隔行)。返回 { width, height, bpp, at(x,y) } */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('缺少 IHDR');
  if (ihdr.depth !== 8 || ihdr.interlace !== 0 || (ihdr.color !== 2 && ihdr.color !== 6)) {
    throw new Error(`不支持的 PNG 形态 depth=${ihdr.depth} color=${ihdr.color} interlace=${ihdr.interlace}`);
  }
  const channels = ihdr.color === 6 ? 4 : 3;
  const bpp = channels;
  const stride = ihdr.w * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * ihdr.h);
  let p = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[p++];
    const cur = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) cur[i] = (cur[i] + a) & 255;
      else if (filter === 2) cur[i] = (cur[i] + b) & 255;
      else if (filter === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else if (filter !== 0) throw new Error('未知 filter ' + filter);
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return {
    width: ihdr.w,
    height: ihdr.h,
    channels,
    /** [r,g,b] 或 [r,g,b,a] */
    at(x, y) {
      const i = y * stride + x * channels;
      return Array.from(out.subarray(i, i + channels));
    },
  };
}

/** WCAG 相对亮度(sRGB 通道 0-255) */
export function luminance([r, g, b]) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 对比度 (1..21) */
export function contrast(rgb1, rgb2) {
  const l1 = luminance(rgb1);
  const l2 = luminance(rgb2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export const hex = (rgb) => '#' + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');

/** 取一列像素里出现次数最多的颜色(用于判定轨道色/滑块色) */
export function columnHistogram(img, x, y0, y1) {
  const counts = new Map();
  for (let y = y0; y < y1; y++) {
    const key = img.at(x, y).slice(0, 3).join(',');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, n]) => ({ rgb: k.split(',').map(Number), n }))
    .sort((a, b) => b.n - a.n);
}

/**
 * 在一列像素里找竖直连续色段(用于区分滚动条轨道与滑块):
 * 从 y0 到 y1-1 逐行取色,颜色变化即断段;返回 [{ rgb, y0, y1, height }]。忽略 alpha<250 的透明行。
 */
export function columnRuns(img, x, y0, y1, alphaThreshold = 250) {
  const runs = [];
  let cur = null;
  for (let y = y0; y < y1; y++) {
    const px = img.at(x, y);
    const key = px[3] !== undefined && px[3] < alphaThreshold ? 'transparent' : px.slice(0, 3).join(',');
    if (cur && cur.key === key) cur.y1 = y;
    else {
      if (cur) runs.push(cur);
      cur = { key, rgb: key === 'transparent' ? null : key.split(',').map(Number), y0: y, y1: y };
    }
  }
  if (cur) runs.push(cur);
  return runs
    .filter((r) => r.y1 - r.y0 + 1 >= 2)
    .map((r) => ({ rgb: r.rgb, y0: r.y0, y1: r.y1, height: r.y1 - r.y0 + 1 }));
}

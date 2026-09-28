import type { Point } from './radial';

/** 相机:世界坐标 -> 屏幕坐标的相似变换(先缩放 k,再平移 tx/ty) */
export interface Camera { k: number; tx: number; ty: number }

export const MIN_K = 0.2;
export const MAX_K = 4;

export function screenOf(p: Point, cam: Camera): Point {
  return { x: p.x * cam.k + cam.tx, y: p.y * cam.k + cam.ty };
}

/**
 * 把点集框进 w×h 画布,四周留 pad 比例的边距。
 * @param pad 边距比例,要求 ∈ [0, 0.5);w/h 为 CSS 像素。
 */
export function fitToView(points: readonly Point[], w: number, h: number, pad = 0.05): Camera {
  if (points.length === 0) return { k: 1, tx: w / 2, ty: h / 2 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // 防御性下界 1:重合点集会让 span 为 0(除零),画布 > 4.4px 时该下界不影响输出(k 仍会被夹到 MAX_K)。
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const k = Math.min((w * (1 - pad * 2)) / spanX, (h * (1 - pad * 2)) / spanY);
  const clamped = Math.min(Math.max(k, MIN_K), MAX_K);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k: clamped, tx: w / 2 - cx * clamped, ty: h / 2 - cy * clamped };
}

/**
 * 以光标为中心缩放:该屏幕点下的世界坐标保持不动。
 * @param cam 输入相机,要求 k > 0;at 为屏幕点(CSS 像素)。
 * @returns k 夹在 MIN_K–MAX_K 的新相机(夹取时 tx/ty 按实际比例补偿,锚定仍成立)。
 */
export function zoomAt(cam: Camera, factor: number, at: Point): Camera {
  const k = Math.min(Math.max(cam.k * factor, MIN_K), MAX_K);
  const ratio = k / cam.k;
  return { k, tx: at.x - (at.x - cam.tx) * ratio, ty: at.y - (at.y - cam.ty) * ratio };
}

/**
 * 视口裁剪:返回屏幕位置落在画布(含 margin 外扩)内的点 id。
 * @param w 画布宽,h 画布高,margin 四周外扩量 —— 单位均为 CSS 像素,边界含等号。
 */
export function cullVisible(
  points: Map<number, Point>,
  cam: Camera,
  w: number,
  h: number,
  margin = 40,
): number[] {
  const out: number[] = [];
  for (const [id, p] of points) {
    const s = screenOf(p, cam);
    if (s.x >= -margin && s.x <= w + margin && s.y >= -margin && s.y <= h + margin) out.push(id);
  }
  return out;
}

/** LOD 三档:<0.6 只有点;0.6–1.2 加枢纽文字;>1.2 全文字 */
export function lodLevel(k: number): 'dots' | 'hubs' | 'all' {
  if (k < 0.6) return 'dots';
  if (k <= 1.2) return 'hubs';
  return 'all';
}

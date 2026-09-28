import type { Point } from './radial';

/** 相机:世界坐标 -> 屏幕坐标的相似变换(先缩放 k,再平移 tx/ty) */
export interface Camera { k: number; tx: number; ty: number }

export const MIN_K = 0.2;
export const MAX_K = 4;

export function screenOf(p: Point, cam: Camera): Point {
  return { x: p.x * cam.k + cam.tx, y: p.y * cam.k + cam.ty };
}

/** 把点集框进 w×h 画布,四周留 pad 比例的边距 */
export function fitToView(points: readonly Point[], w: number, h: number, pad = 0.05): Camera {
  if (points.length === 0) return { k: 1, tx: w / 2, ty: h / 2 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const k = Math.min((w * (1 - pad * 2)) / spanX, (h * (1 - pad * 2)) / spanY);
  const clamped = Math.min(Math.max(k, MIN_K), MAX_K);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k: clamped, tx: w / 2 - cx * clamped, ty: h / 2 - cy * clamped };
}

/** 以光标为中心缩放:该屏幕点下的世界坐标保持不动;k 夹在 MIN_K–MAX_K */
export function zoomAt(cam: Camera, factor: number, at: Point): Camera {
  const k = Math.min(Math.max(cam.k * factor, MIN_K), MAX_K);
  const ratio = k / cam.k;
  return { k, tx: at.x - (at.x - cam.tx) * ratio, ty: at.y - (at.y - cam.ty) * ratio };
}

/** 视口裁剪:返回屏幕位置落在画布(含 margin 外扩)内的点 id */
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

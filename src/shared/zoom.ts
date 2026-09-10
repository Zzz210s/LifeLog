export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.05;

export function clampZoom(z: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
}

export function wheelZoom(current: number, deltaY: number): number {
  return clampZoom(current + (deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}

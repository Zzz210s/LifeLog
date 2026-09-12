// 快捷窗视图(缩放/透明度)的纯函数与取值范围。
// 步长语义:设置里的步长是「百分点」——缩放 10 表示每次 0.10;透明度 5 表示每次 5 个点。
import type { QuickSettings } from './quick-settings';

export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2.0;
export const OPACITY_MIN = 30;
export const OPACITY_MAX = 100;
/** 设置项步长的合法区间(百分点) */
export const STEP_MIN = 1;
export const STEP_MAX = 50;

export type WheelDirection = 1 | -1;

/** 缩放收敛到 0.5-2.0 的两位小数;非有限值回退 1.0 */
export function clampScale(z: number): number {
  if (!Number.isFinite(z)) return 1;
  const c = Math.min(SCALE_MAX, Math.max(SCALE_MIN, z));
  return Math.round(c * 100) / 100;
}

export function clampOpacity(o: number): number {
  if (!Number.isFinite(o)) return OPACITY_MAX;
  return Math.round(Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, o)));
}

export function clampStep(s: number): number {
  if (!Number.isFinite(s)) return STEP_MIN;
  return Math.round(Math.min(STEP_MAX, Math.max(STEP_MIN, s)));
}

/** 滚轮缩放:方向 1 放大 / -1 缩小 */
export function nextScale(current: number, direction: WheelDirection, stepPercent: number): number {
  const base = Number.isFinite(current) ? current : 1;
  return clampScale(base + direction * (stepPercent / 100));
}

/** Ctrl+滚轮调透明度:方向 1 更不透明 / -1 更透明 */
export function nextOpacity(
  current: number,
  direction: WheelDirection,
  stepPercent: number,
): number {
  const base = Number.isFinite(current) ? current : OPACITY_MAX;
  return clampOpacity(base + direction * stepPercent);
}

/** 中键:缩放回 100%,透明度回「默认透明度」设置值 */
export function resetView(s: QuickSettings): { scale: number; opacity: number } {
  return { scale: 1, opacity: clampOpacity(s.defaultOpacity) };
}

/** Ctrl 按下时调透明度,否则缩放 */
export function wheelAction(e: { ctrlKey: boolean }): 'opacity' | 'scale' {
  return e.ctrlKey ? 'opacity' : 'scale';
}

/**
 * 设置重载回读时是否采用库里的值:本会话内已改但尚未结算(节流中或 IPC 在途)的键一律跳过。
 * 否则库里的旧值会覆盖用户刚调好的透明度/缩放,界面自己弹回去。
 */
export function shouldApplyStored(key: string, pending: ReadonlySet<string>): boolean {
  return !pending.has(key);
}

/** 滚轮方向:向上(deltaY < 0)为放大/更不透明 */
export function wheelDirection(deltaY: number): WheelDirection {
  return deltaY < 0 ? 1 : -1;
}

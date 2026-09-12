// 读取输入栏当前几何:逻辑尺寸(命令与钳制的单位)、系统缩放、物理位置,
// 以及「逻辑像素 / CSS 像素」比值 —— webview 缩放会让两者不等,换算窗口尺寸必须用它。
import { getCurrentWindow } from '@tauri-apps/api/window';

export type WindowGeometry = {
  /** 逻辑宽度(与 Rust set_input_size 同一单位) */
  width: number;
  /** 逻辑高度 */
  height: number;
  /** 逻辑 -> 物理的缩放系数 */
  scale: number;
  /** 物理左边缘 */
  x: number;
  /** 物理上边缘 */
  y: number;
  /** 逻辑像素 / CSS 像素 */
  ratio: number;
};

/**
 * 最近一次 readGeometry 读到的 ratio。热区宽度换算必须在同步的 mousedown 回调里完成,
 * 不能等异步读数;readGeometry 每次成功都会刷新它(内容/宽度变化与缩放重算时都会读到)。
 */
let lastRatio = 1;

/** 同步取当前 ratio(逻辑像素 / CSS 像素);尚未读到几何时按 1 处理 */
export function currentRatio(): number {
  return lastRatio;
}

export async function readGeometry(): Promise<WindowGeometry | null> {
  try {
    const win = getCurrentWindow();
    const [phys, scale, pos] = await Promise.all([
      win.innerSize(),
      win.scaleFactor(),
      win.outerPosition(),
    ]);
    const logical = phys.toLogical(scale);
    const css = document.documentElement.clientWidth;
    const ratio = css > 0 ? logical.width / css : 1;
    lastRatio = ratio;
    return {
      width: logical.width,
      height: logical.height,
      scale,
      x: pos.x,
      y: pos.y,
      ratio,
    };
  } catch {
    return null; // 非 Tauri 环境(浏览器/单测)下静默降级
  }
}

// 读取快捷窗当前几何:逻辑尺寸(命令与钳制的单位)、系统缩放、物理位置,
// 以及「逻辑像素 / CSS 像素」比值 —— webview 缩放会让两者不等,换算窗口尺寸必须用它。
import { getCurrentWindow } from '@tauri-apps/api/window';

export type WindowGeometry = {
  /** 逻辑宽度(与 Rust set_quick_size 同一单位) */
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
    return {
      width: logical.width,
      height: logical.height,
      scale,
      x: pos.x,
      y: pos.y,
      ratio: css > 0 ? logical.width / css : 1,
    };
  } catch {
    return null; // 非 Tauri 环境(浏览器/单测)下静默降级
  }
}

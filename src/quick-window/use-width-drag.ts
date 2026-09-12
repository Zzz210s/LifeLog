import { useCallback } from 'react';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { api } from '../shared/api';
import { clampWidth, edgeBandCss, edgeSide, GLOW_PAD, type Side } from '../shared/quick-geometry';
import { pressKind } from '../shared/quick-gestures';
import { currentRatio, readGeometry } from './logical-size';
import { windowHeightFor } from './use-auto-height';

/** 拖动期间最多 10 次/秒落尺寸,避免 IPC 与重排过密 */
const THROTTLE_MS = 100;

/**
 * 左右最外 8 **逻辑像素**:按下拖动改宽度(逻辑像素 240-900),高度按新换行重算。
 * 热区随缩放同比放大(CSS 宽度 = edgeBandCss(ratio),0.5 缩放时 16 CSS px、2.0 时 4 CSS px),
 * 故不同缩放下手感一致;edgeSide 仍按「CSS 像素 band」判定,换算在下面调用处完成。
 * **宽度拉伸不受「阻止移动」锁定影响**(用户 2026-09-11 决定):该锁定只拦窗口移动
 * (见 use-drag-band 的 locked),左右边缘始终可改宽度,此处故意不接收 locked。
 * 双击优先(detail >= 2 一律走双击动作,不进入宽度拖动)。
 * 返回 true 表示本次按下已被接管,调用方不再走「移动窗口」逻辑。
 */
export function useWidthDrag(opts: {
  textareaRef: { current: HTMLTextAreaElement | null };
  onDoubleClick: () => void;
}) {
  const { textareaRef, onDoubleClick } = opts;

  return useCallback(
    (e: React.MouseEvent): boolean => {
      if (e.button !== 0) return false;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      // 热区换算:8 逻辑像素 -> CSS 像素(ratio 取自最近一次 readGeometry,同步可读)
      const side = edgeSide(e.clientX - rect.left, rect.width, edgeBandCss(currentRatio()));
      if (!side) return false;
      if (pressKind(e.detail) === 'double') {
        e.preventDefault();
        onDoubleClick();
        return true;
      }
      const ta = textareaRef.current;
      if (!ta) return true;
      e.preventDefault();
      void startWidthDrag(side, e.screenX, ta);
      return true;
    },
    [onDoubleClick, textareaRef],
  );
}

async function startWidthDrag(
  side: Side,
  startScreenX: number,
  ta: HTMLTextAreaElement,
): Promise<void> {
  const geo = await readGeometry();
  if (!geo) return;
  const { ratio, scale, x, y, width: startWidth } = geo;
  let lastScreenX = startScreenX;
  let lastAt = 0;

  // 宽度与高度一次算好一起落:宽度改变会改变换行行数,高度必须同时跟上。
  // 位移必须用 screenX:它按系统缩放换算(physical / scale),数值上就是窗口逻辑像素,
  // 不受 webview 页面 zoom 影响;而 clientX 是页面 CSS 像素,左边缘拖动时窗口原点会跟着
  // 移动,同一个位移会被自身抵消一半(实测拖 100 像素只生效 50)。
  const apply = (screenX: number) => {
    const delta = (side === 'left' ? -1 : 1) * (screenX - startScreenX);
    const width = clampWidth(startWidth + delta);
    // windowHeightFor 的第 3 个参数是**输入框**的 border-box 宽度(cssWidth),
    // 而这里是**窗口**的 CSS 宽度:窗口根节点有 p-[14px] 且 Tailwind preflight 为 border-box,
    // 输入框比窗口窄 2 x GLOW_PAD。不减掉就会按偏宽的宽度测量换行、少算一行,
    // 窗口变矮、滚动条提前出现(拖动路径专用;自动高度路径传的是实测宽度,不受影响)。
    const height = windowHeightFor(ta, ratio, width / ratio - 2 * GLOW_PAD);
    void api.setQuickSize(width, height).catch(() => {});
    if (side === 'left') {
      // 左边缘:窗口左边界跟手(宽度减多少,位置就右移多少)
      const dx = Math.round((startWidth - width) * scale);
      void getCurrentWindow()
        .setPosition(new PhysicalPosition(x + dx, y))
        .catch(() => {});
    }
  };

  const onMove = (ev: MouseEvent) => {
    // 主键已松开(mouseup 在甩动/指针出窗时可能丢失):立刻收尾,避免拖动会话残留
    if ((ev.buttons & 1) === 0) {
      onUp();
      return;
    }
    lastScreenX = ev.screenX;
    const now = performance.now();
    if (now - lastAt < THROTTLE_MS) return;
    lastAt = now;
    apply(lastScreenX);
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    apply(lastScreenX); // 收尾:节流可能吞掉最后一次移动
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

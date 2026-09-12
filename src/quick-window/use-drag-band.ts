import { useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isInDragBand, pressKind } from '../shared/quick-gestures';
import { dragBandCss } from '../shared/quick-geometry';
import { currentRatio } from './logical-size';

// 可拖动移动窗口的区域 = 上下最外 8 **逻辑像素**带 + 输入框外的 14 CSS 像素光晕内边距环,
// 取两者较大者:低缩放(ratio 0.5)时 8 逻辑像素 = 16 CSS px,比环还宽,热区随缩放一起放大;
// 高缩放时环已盖住 8 逻辑像素,取环即可(不把既有可拖动环缩窄)。
// 左右最外 8 逻辑像素另由 use-width-drag 优先接管改宽度(见 QuickCapture 的 onRootMouseDown);
// 输入框内的中部区域不拖动,保留文本选择。
// **「阻止移动」只拦这里的窗口移动,不拦左右边缘的宽度拉伸**(用户 2026-09-11 决定:
// 锁定移动不等于锁死宽度;宽度改动见 use-width-drag)
// 双击在 mousedown 阶段判定(e.detail >= 2),因为原生拖动会吞掉后续 dblclick;
// locked 只拦拖动,不拦双击(「阻止关闭」才拦隐藏)。
export function useDragBand(opts: { locked: boolean; onDoubleClick: () => void }) {
  const { locked, onDoubleClick } = opts;
  return useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const inside = isInDragBand(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
        dragBandCss(currentRatio()),
      );
      if (!inside) return;
      if (pressKind(e.detail) === 'double') {
        e.preventDefault();
        onDoubleClick();
        return;
      }
      if (locked) return;
      void getCurrentWindow().startDragging();
    },
    [locked, onDoubleClick],
  );
}

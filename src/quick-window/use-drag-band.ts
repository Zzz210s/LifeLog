import { useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isInDragBand, pressKind } from '../shared/quick-gestures';
import { GLOW_PAD } from '../shared/quick-geometry';

// 可拖动移动窗口的区域 = 上下最外 8 像素带 + 输入框外的 14 像素光晕内边距环
// (GLOW_PAD 14 >= DRAG_BAND 8,故整环已覆盖上下带)。
// 左右最外 8 像素另由 use-width-drag 优先接管改宽度(见 QuickCapture 的 onRootMouseDown);
// 输入框内的中部区域不拖动,保留文本选择。
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
        GLOW_PAD,
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

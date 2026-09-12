import { useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isInDragBand, pressKind } from '../shared/quick-gestures';

// 窗口最外 8 像素的拖动带:兼双击目标。
// 双击在 mousedown 阶段判定(e.detail === 2),因为原生拖动会吞掉后续 dblclick;
// locked 只拦拖动,不拦双击(「阻止关闭」才拦隐藏)。
export function useDragBand(opts: { locked: boolean; onDoubleClick: () => void }) {
  const { locked, onDoubleClick } = opts;
  return useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const inside = isInDragBand(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
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

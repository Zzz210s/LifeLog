/**
 * 输入栏根元素的鼠标路由 + 点一下就允许取焦点。
 *
 * 优先级:中键恢复视图 → 左右带(双击或宽度拖动)→ 上下带(双击或移动窗口)。
 * 每次按下都先 `focusOnClick()` —— 唤起时默认不夺焦点(见 use-focus-on-click.ts),
 * 只有用户主动点这里才打开可聚焦。
 *
 * 从 InputBar.tsx 拆出以守住 200 行上限。
 */
import { useCallback, type RefObject } from 'react';
import { canDrag } from '../shared/input-lock';
import { useDragBand } from './use-drag-band';
import { useFocusOnClick } from './use-focus-on-click';
import { useWidthDrag } from './use-width-drag';

export interface RootMouseOptions {
  lock: { move: boolean; close: boolean; content: boolean };
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDoubleClick: () => void;
  onMiddleDown: (e: React.MouseEvent) => boolean;
}

export function useRootMouse(p: RootMouseOptions): (e: React.MouseEvent) => void {
  const focusOnClick = useFocusOnClick();
  const band = useDragBand({ locked: !canDrag(p.lock), onDoubleClick: p.onDoubleClick });
  const width = useWidthDrag({ textareaRef: p.textareaRef, onDoubleClick: p.onDoubleClick });
  return useCallback(
    (e: React.MouseEvent): void => {
      focusOnClick();
      if (p.onMiddleDown(e)) return;
      if (width(e)) return;
      band(e);
    },
    [focusOnClick, p, width, band],
  );
}

/**
 * 输入栏根元素的鼠标路由 + 点一下就允许取焦点。
 *
 * 优先级:中键恢复视图 → 左右带(双击或宽度拖动)→ 底边带(双击复位下限或改最小高度)
 * → 上下带(双击或移动窗口)。
 * 底边带要排在上下带**之前**:两者共用同一个「可见卡片边缘带」,排后面的话底边永远判进
 * 「移动窗口」,高度就还是只能靠内容自动定(2026-10-16 的缺陷)。
 * 每次按下都先 `focusOnClick()` —— 唤起时默认不夺焦点(见 use-focus-on-click.ts),
 * 只有用户主动点这里才打开可聚焦。
 *
 * 从 InputBar.tsx 拆出以守住 200 行上限。
 */
import { useCallback, type RefObject } from 'react';
import { canDrag } from '../shared/input-lock';
import { useDragBand } from './use-drag-band';
import { useFocusOnClick } from './use-focus-on-click';
import { useHeightDrag } from './use-height-drag';
import { useWidthDrag } from './use-width-drag';

export interface RootMouseOptions {
  lock: { move: boolean; close: boolean; content: boolean };
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDoubleClick: () => void;
  onMiddleDown: (e: React.MouseEvent) => boolean;
  /** 底边拖动改「最小高度」下限:applyMin = 拖动中的本地态,commitMin = 松手后写库 */
  applyMin: (h: number) => void;
  commitMin: (h: number) => void;
}

export function useRootMouse(p: RootMouseOptions): (e: React.MouseEvent) => void {
  const focusOnClick = useFocusOnClick();
  const band = useDragBand({ locked: !canDrag(p.lock), onDoubleClick: p.onDoubleClick });
  const width = useWidthDrag({ textareaRef: p.textareaRef, onDoubleClick: p.onDoubleClick });
  const height = useHeightDrag({
    textareaRef: p.textareaRef,
    applyMin: p.applyMin,
    commitMin: p.commitMin,
  });
  return useCallback(
    (e: React.MouseEvent): void => {
      focusOnClick();
      if (p.onMiddleDown(e)) return;
      if (width(e)) return;
      if (height(e)) return;
      band(e);
    },
    [focusOnClick, p, width, height, band],
  );
}

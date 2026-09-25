/**
 * 下拉浮层的关闭手势(点外部 / Esc),自 AddConditionMenu、TopBarMenu 的同款写法抽出。
 *
 * Esc 在**捕获阶段**拦下并 stopPropagation:不能让它冒泡到窗口级(那会隐藏输入栏);
 * 回调走 ref 现读 —— 浮层可能开着很久,不能闭包住旧的 props(内联箭头每次渲染都换身份)。
 * `open` 为假时不挂监听;`root` 之外的 mousedown 才算点外部。
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export function useDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, root]);
}

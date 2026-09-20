/**
 * 标签菜单的关闭手势(自 TagMenu.tsx 纯搬移,守 200 行上限):
 * Esc 关闭 —— 在捕获阶段拦下并 stopPropagation,不让 Esc 冒泡到窗口级(那会隐藏输入栏);
 * 菜单外 mousedown 关闭。
 */
import { useEffect } from 'react';

export function useTagMenuDismiss(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-tag-menu]')) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
}

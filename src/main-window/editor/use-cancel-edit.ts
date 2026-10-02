import { useCallback, type MutableRefObject } from 'react';

/**
 * 主动取消编辑(Esc / 内容未变时的退出):**先置取消标记**,卸载兜底才不写库。
 *
 * 2026-10-01 修:`cancelled` 此前从未被置真 —— Esc 取消后面板卸载,兜底会把已取消的改动写进库
 * (真机复现:面板已退出,库里却出现了被取消的文本)。用例在 `edit-panel-cancel.dom.test.ts`。
 *
 * 注意「笔记已被并发删除」那条路径不走这里(那时也不该保存,但语义不是"用户取消")。
 */
export function useCancelEdit(
  cancelled: MutableRefObject<boolean>,
  onCancel: () => void,
): () => void {
  return useCallback((): void => {
    cancelled.current = true;
    onCancel();
  }, [cancelled, onCancel]);
}

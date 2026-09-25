/**
 * 焦点离开整个输入区就关下拉(计划 3/3 Task 3)。
 *
 * 生产里没有任何 blur/focusout 处理,于是点顶栏 `⋯`、点条件栏「添加条件」时输入框的候选下拉
 * 会留着,与那些点击产生的菜单同屏叠浮层。这里用 `focusout`(React 的 onBlur 冒泡)判定:
 * `relatedTarget` 落在容器内(点候选行)就不关;为 null(点不可聚焦处)算离开。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { FocusEvent, RefObject } from 'react';

export function useCloseOnFocusOut(
  open: boolean,
  close: () => void
): {
  ref: RefObject<HTMLDivElement | null>;
  onBlur: (e: FocusEvent<HTMLDivElement>) => void;
  onFocus: () => void;
} {
  const ref = useRef<HTMLDivElement>(null);
  const pending = useRef<number | null>(null);

  /** 撤销挂起的关闭:焦点又回到输入区时用(见 onFocus) */
  const cancel = useCallback(() => {
    if (pending.current !== null) {
      cancelAnimationFrame(pending.current);
      pending.current = null;
    }
  }, []);

  const onBlur = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      if (!open || ref.current?.contains(e.relatedTarget)) return;
      // **推迟到下一帧再关**:下拉在文档流里,关掉会让下方内容(条件栏、笔记流)整体上移;
      // 若在 mousedown 阶段就关,鼠标抬起时目标已经移位 -> 浏览器把 click 派发到两次命中的共同
      // 祖先,用户会觉得“第一次点击被吞了”。等一帧后 click 已经派发完毕,再关就不影响它。
      cancel();
      pending.current = requestAnimationFrame(() => {
        pending.current = null;
        close();
      });
    },
    [open, close, cancel]
  );

  /** 焦点回到输入区(例如点侧栏「筛选标签」把 `#` 预填进来)-> 撤销挂起的关闭,
   *  否则刚打开的下拉会被上一帧的 blur 顺手关掉 */
  const onFocus = useCallback(() => cancel(), [cancel]);

  useEffect(() => cancel, [cancel]); // 卸载时不留挂起回调
  return { ref, onBlur, onFocus };
}

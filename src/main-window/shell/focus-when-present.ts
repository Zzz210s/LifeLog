/**
 * 「等元素出现再聚焦」:命令把视图切到设置页后,目标元素要等 React 提交才存在
 * (`hotkey.edit` -> 设置页的快捷键录制器)。逐帧重试,避免依赖 setState 与 rAF 的时序假设。
 */
export const FOCUS_RETRY_FRAMES = 10;

export function focusWhenPresent(selector: string, tries: number = FOCUS_RETRY_FRAMES): void {
  const attempt = (left: number): void => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el !== null) {
      el.focus();
      return;
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1));
  };
  attempt(tries);
}

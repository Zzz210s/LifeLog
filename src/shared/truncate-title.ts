/**
 * 悬浮提示只在文本**被 CSS 截断**时才挂 `title`。
 *
 * 为什么:未截断时提示内容与可见文字一字不差,纯属噪声(用户反馈:默认标签悬停弹出「同标题内容说明」)。
 * 截断时提示才有价值 —— 它把被省略号吃掉的后半段还给你。
 *
 * 用法(两条等价路径):
 * - React:`<button onMouseEnter={hoverTitle(text)}>`
 * - 直接调用:`titleIfTruncated(el, text)`
 *
 * 判定用 `scrollWidth > clientWidth`:与 `text-overflow: ellipsis`(Tailwind `truncate`)同源,
 * 元素必须有确定的宽度约束(如 `max-w-[16rem]`),否则永远判为未截断。
 */
export function titleIfTruncated(el: HTMLElement | null | undefined, text: string): void {
  if (!el) return;
  if (el.scrollWidth > el.clientWidth) el.setAttribute('title', text);
  else el.removeAttribute('title');
}

/** `onMouseEnter` 形态:每次进入都重判(窗口尺寸/内容都会变,不能只在挂载时算一次) */
export function hoverTitle(text: string): (e: { currentTarget: HTMLElement }) => void {
  return (e) => titleIfTruncated(e.currentTarget, text);
}

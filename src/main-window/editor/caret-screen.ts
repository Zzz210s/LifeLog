/**
 * 进编辑后让**光标停在鼠标点击的那个屏幕位置**(用户 2026-10-03:"光标位置和鼠标悬停位置不变为准")。
 *
 * 为什么需要:编辑面板比原卡片高、而且点击往往落在长卡片的中下部,面板一挂载其顶部就在视口之上,
 * 于是编辑框(和光标)跑到屏幕外 —— 用户看到的只是下面一堆卡片。只还原 scrollTop 解决不了这个问题,
 * 因为"光标在框内的位置"与"框在屏幕上的位置"是两件事。
 *
 * 做法:量出光标相对**视口**的 y(框的 rect + 镜像量出的框内偏移 − 框自身滚动),
 * 与点击时的视口 y 相减,把差值加到流的滚动位置上 —— 光标就回到鼠标刚才的位置。
 * 越界由 scrollTop 的夹取兜住(不会滚出文档范围)。
 */
export interface CaretScreenInput {
  /** 编辑框相对视口的顶部 */
  boxTop: number;
  /** 光标在框内容里的纵向位置(镜像量出) */
  caretInBox: number;
  /** 框自身的滚动 */
  boxScroll: number;
  /** 点击时光标所在的视口 y */
  clickY: number;
}

/** 需要给流补的滚动增量(正数 = 往下滚) */
export function caretScrollDelta(o: CaretScreenInput): number {
  const { boxTop, caretInBox, boxScroll, clickY } = o;
  if (![boxTop, caretInBox, boxScroll, clickY].every(Number.isFinite)) return 0;
  const caretViewportY = boxTop + caretInBox - boxScroll;
  return Math.round(caretViewportY - clickY);
}

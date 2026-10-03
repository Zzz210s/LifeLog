/**
 * 量出**光标在源码框里的真实纵向位置**(用户 2026-10-03:靠行号估算在长段落折行时会严重偏低,
 * 结果框滚到最底、光标反而看不见了)。
 *
 * 做法:造一个与 textarea 同样式(字体/行高/宽度/换行/padding)的隐藏镜像 div,
 * 内容 = 光标之前的文本 + 一个零宽标记,量标记相对镜像顶部的距离 —— 折行由浏览器自己算,精确。
 * 量不到(拿不到计算样式 / 没有 offsetParent)返回 null,调用方退回估算。
 */
const COPY = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'textIndent', 'textTransform', 'whiteSpace', 'wordWrap', 'overflowWrap', 'padding', 'border', 'boxSizing',
  'tabSize', 'direction', 'textRendering',
] as const;

export function measureCaretTop(box: HTMLTextAreaElement, caret: number): number | null {
  const doc = box.ownerDocument;
  const parent = box.parentElement;
  if (!parent) return null;
  const cs = doc.defaultView?.getComputedStyle(box);
  if (!cs) return null;
  const mirror = doc.createElement('div');
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-10000px';
  mirror.style.visibility = 'hidden';
  mirror.style.height = 'auto';
  mirror.style.width = `${box.clientWidth}px`;
  for (const key of COPY) mirror.style[key] = cs[key];
  mirror.textContent = box.value.slice(0, Math.max(0, caret));
  const marker = doc.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  parent.appendChild(mirror);
  const boxRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();
  const top = markerRect.top - boxRect.top;
  return Number.isFinite(top) ? top : null;
}

/** 让光标行落在框内约 1/3 高度处;越界夹到合法范围 */
export function caretScrollFromTop(
  caretTop: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  if (!Number.isFinite(caretTop) || clientHeight <= 0) return 0;
  const max = Math.max(0, scrollHeight - clientHeight);
  const target = caretTop - clientHeight / 3;
  return Math.max(0, Math.min(max, Math.round(target)));
}

/**
 * 单元格"点哪儿光标落哪儿"的换算(用户 2026-10-03)。
 *
 * 预览态渲染的是行内 markdown 的**结果**(`**粗**` 显示成「粗」),编辑框里是**源码**。
 * 点在第 N 个**可见字符**上时,光标该落在源码的第几个字符上 —— 本函数做这个换算:
 * 按源码扫描,遇到 markdown 标记字符跳过(它们不占可见位置),其余字符计入可见偏移。
 *
 * 只做「跳过标记字符」这一件事,不解析结构:对**纯文本单元格精确**(绝大多数格子),
 * 对含标记的格子是近似(可能差一两个字符)—— 这比把光标丢到开头/末尾好得多。
 * 标记集与 renderMarkdown 的行内规则对应:`**` `__` `*` `_` `` ` `` `~~` `[[…]]` `[…](…)`。
 */
const MARKERS = new Set(['*', '_', '`', '~', '[', ']', '(', ')']);

/** 可见偏移 → 源码偏移;越界收敛到 [0, text.length] */
export function sourceOffsetForVisible(text: string, visibleOffset: number): number {
  if (visibleOffset <= 0) return 0;
  let visible = 0;
  let i = 0;
  while (i < text.length) {
    if (MARKERS.has(text[i])) {
      i += 1;
      continue;
    }
    visible += 1;
    i += 1;
    if (visible === visibleOffset) {
      // 光标落在第 N 个可见字符**之后**:紧跟的标记(如 `**` 的收尾)也一并跳过去
      while (i < text.length && MARKERS.has(text[i])) i += 1;
      return i;
    }
  }
  return text.length;
}

/**
 * 点在单元格上的**可见文本偏移**(相对整格的渲染文本)。
 *
 * Chromium 的 caretRangeFromPoint 给出点击处的文本节点与节点内偏移;再把该节点之前的文本节点
 * 长度累加,得到「第几个可见字符」。点在空白/padding 上(拿不到 range 或落在格子之外)返回 null。
 */
export function visibleOffsetAtPoint(cell: HTMLElement, x: number, y: number): number | null {
  const doc = cell.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = doc.caretRangeFromPoint?.(x, y);
  if (!range || !cell.contains(range.startContainer)) return null;
  const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === range.startContainer) return offset + range.startOffset;
    offset += node.textContent?.length ?? 0;
  }
  return null;
}

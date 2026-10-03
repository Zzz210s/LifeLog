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
 * Chromium 的 caretRangeFromPoint 给出点击处的范围;两种形态都要处理:
 *   - **文本节点**容器:`startOffset` 是节点内字符偏移 → 累加它之前的文本长度;
 *   - **元素**容器:`startOffset` 是**子节点下标** → 累加它之前子树的文本长度。
 * 实测(2026-10-03)点在表格单元格上时 Chromium 给的是后者 —— 只处理文本节点会永远返回 null,
 * 光标就退回浏览器默认位置。
 */
export function visibleOffsetAtPoint(cell: HTMLElement, x: number, y: number): number | null {
  const doc = cell.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = doc.caretRangeFromPoint?.(x, y);
  if (!range || !cell.contains(range.startContainer)) return null;
  const container = range.startContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    let offset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node === container) return offset + range.startOffset;
      offset += node.textContent?.length ?? 0;
    }
    return null;
  }
  let offset = 0;
  const kids = container.childNodes;
  for (let i = 0; i < range.startOffset && i < kids.length; i += 1) {
    offset += kids[i].textContent?.length ?? 0;
  }
  return offset;
}

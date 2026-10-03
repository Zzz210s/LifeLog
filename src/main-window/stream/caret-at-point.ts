/**
 * 单元格"点哪儿光标落哪儿"的换算(用户 2026-10-03)。
 *
 * 预览态渲染的是行内 markdown 的**结果**(`**粗**` 显示成「粗」),编辑框里是**源码**,
 * 所以要做两件事:①按点击位置求出「第几个可见字符」;②把可见偏移换算成源码偏移。
 *
 * ①**不依赖 `caretRangeFromPoint`**:实测(2026-10-03)点在单元格的**留白/内边距**上时,
 * Chromium 返回的是「容器 = td,offset = 0」—— 光标永远落回开头,用户看到的就是"没反应"
 * (短文本的格子,留白占了大半面积)。改成自己量每个字符的矩形,取离点击点最近的**字符边界**:
 * 点在最左 → 0;点在某个字中间 → 按左右半区决定落在它前面还是后面;点在最右 → 文本末尾。
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

/** 一个字符的屏幕矩形(只留判定要用的四个数) */
export interface CharBox {
  left: number;
  right: number;
  centerY: number;
}

/**
 * 最近的**字符边界**(纯函数,便于单测):返回 0..chars.length。
 *
 * 打分 = 纵向距离 × 1000 + 横向到字符中点的距离 —— 纵向权重高,保证**先选同一行**,
 * 再在该行里挑水平方向最近的字符;点在字符左半区取它前面、右半区取它后面。
 * 空数组返回 0。
 */
export function nearestBoundary(chars: readonly CharBox[], x: number, y: number): number {
  if (chars.length === 0) return 0;
  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestAfter = false;
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    const mid = (c.left + c.right) / 2;
    const score = Math.abs(y - c.centerY) * 1000 + Math.abs(x - mid);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
      bestAfter = x > mid;
    }
  }
  return bestIndex + (bestAfter ? 1 : 0);
}

/** 量出格子里每个**可见字符**的矩形(渲染后的文本节点顺序即阅读顺序) */
function charBoxes(cell: HTMLElement): CharBox[] {
  const doc = cell.ownerDocument;
  // 某些环境(jsdom、极老的引擎)没有 Range.getBoundingClientRect:量不了就返回空数组,
  // 调用方退回默认光标位置 —— 绝不能让点击处理器抛异常(那会连编辑框都开不了)。
  const probe = doc.createRange();
  if (typeof probe.getBoundingClientRect !== 'function') return [];
  const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  const boxes: CharBox[] = [];
  const MAX = 600; // 兜底:超长单元格不做全量测量(极少见,退化成按文本长度估算)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    for (let i = 0; i < text.length; i += 1) {
      if (boxes.length >= MAX) return boxes;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // 换行符之类没有矩形
      boxes.push({ left: rect.left, right: rect.right, centerY: rect.top + rect.height / 2 });
    }
  }
  return boxes;
}

/**
 * 点在单元格上的**可见文本偏移**(相对整格的渲染文本)。量不出任何字符(空单元格)返回 null。
 */
export function visibleOffsetAtPoint(cell: HTMLElement, x: number, y: number): number | null {
  const boxes = charBoxes(cell);
  if (boxes.length === 0) return null;
  return nearestBoundary(boxes, x, y);
}

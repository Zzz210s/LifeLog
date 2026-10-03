/**
 * 「点正文进编辑」时的光标落点(用户 2026-10-03:进条目编辑后光标要跟随点击位置,而不是跑到末尾)。
 *
 * 预览是 markdown 渲染结果,编辑框里是**源码** —— 要把"点在渲染文本的第几个可见字符上"
 * 换算成源码偏移。做法:用 markdown-it 的顶层 token 拿到**第 n 个块的源码行范围**
 * (与渲染出来的顶层元素一一对应),再在块内做"跳过标记字符"的近似换算。
 *
 * 只做"跳过标记"这一件事,不解析结构:纯文本段落精确,带行内标记的段落差一两个字符 ——
 * 比把光标丢到末尾好得多。对不上(块找不到/越界)返回 null,调用方退回原行为(末尾)。
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false });

/** 渲染时会被吞掉的标记字符(行内) */
const MARKERS = new Set(['*', '_', '`', '~', '[', ']', '(', ')']);
/** 行首块标记:标题 / 引用 / 列表 / 有序列表 —— 渲染后不占可见字符 */
const LEADING = /^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/;

/** 顶层块的源码区间(按行号,含起止行) */
export interface BlockRange {
  /** 源码字符起点(该行行首) */
  start: number;
  /** 源码字符终点(该块最后一行的行尾,不含换行) */
  end: number;
}

/** 把源码按行首位置建索引 */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

/** 第 n 个顶层块在源码里的字符区间;越界/无块返回 null */
export function blockRange(source: string, index: number): BlockRange | null {
  const tokens = md.parse(source, {});
  const maps = tokens.filter((t) => t.map && t.level === 0 && t.nesting >= 0).map((t) => t.map as [number, number]);
  const map = maps[index];
  if (!map) return null;
  const starts = lineStarts(source);
  const start = starts[map[0]] ?? null;
  if (start === null) return null;
  // markdown-it 的 map 会把块后的空行也算进来:从末行往前吃掉空行,再吃掉行尾换行
  let lastLine = map[1] - 1;
  while (lastLine > map[0] && source.slice(starts[lastLine], starts[lastLine + 1] ?? source.length).trim() === '') {
    lastLine -= 1;
  }
  const lineEnd = starts[lastLine + 1] ?? source.length;
  return { start, end: Math.max(start, lineEnd - (source[lineEnd - 1] === '\n' ? 1 : 0)) };
}

/**
 * 块内:第 visibleOffset 个**可见字符之后**对应的源码偏移(相对块首)。
 * 逐行扫描,行首块标记与行内标记都不计入可见字符。
 */
export function visibleToSourceOffset(block: string, visibleOffset: number): number {
  if (visibleOffset <= 0) return 0;
  let visible = 0;
  let i = 0;
  let atLineStart = true;
  while (i < block.length) {
    if (atLineStart) {
      const m = LEADING.exec(block.slice(i));
      if (m) {
        i += m[0].length;
        atLineStart = false;
        continue;
      }
    }
    const ch = block[i];
    if (ch === '\n') {
      atLineStart = true;
      i += 1;
      continue;
    }
    atLineStart = false;
    if (MARKERS.has(ch)) {
      i += 1;
      continue;
    }
    visible += 1;
    i += 1;
    if (visible === visibleOffset) {
      while (i < block.length && MARKERS.has(block[i])) i += 1;
      return i;
    }
  }
  return block.length;
}

/** 点在第 index 个块的第 visibleOffset 个可见字符上 -> 源码偏移(绝对);对不上返回 null */
export function sourceOffsetForClick(source: string, index: number, visibleOffset: number): number | null {
  const range = blockRange(source, index);
  if (!range) return null;
  const block = source.slice(range.start, range.end);
  const rel = visibleToSourceOffset(block, visibleOffset);
  const offset = range.start + rel;
  // 末行 `#标签` 之前:别把光标放进标签行(与既有"光标落正文末尾"的口径一致)
  const cut = source.lastIndexOf('\n');
  return cut > 0 && offset > cut ? cut : offset;
}

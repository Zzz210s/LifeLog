/**
 * 任务列表复选框 <-> 正文源码的映射(纯函数,无副作用、不碰 DOM)。
 *
 * 索引语义:按文档顺序数「任务列表项」,与 markdown-it-task-lists 的产出顺序一一对应。
 * 判定不靠正则扫源码猜块结构,而是复用 markdown-it 的块级解析结果,套用该插件完全相同的三条:
 * 连续 token 为 list_item_open -> paragraph_open -> inline,且 inline 源码以 "[ ] " / "[x] " / "[X] " 开头。
 * 于是围栏代码块、缩进代码块、行内代码、非首段的 "[ ]" 都不会被算进来(插件同样不认它们)。
 * 块级切分只由 markdown-it 默认解析决定:渲染管线的 html/linkify/typographer 选项不影响块结构。
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt();

/** 锚定在段首:插件只认后随一个空格的三种标记,`- [ ]`(无内容)与 `- [x]foo` 都不算任务项 */
const TODO_AT_START = /^\[([ xX])\] /;
/** 行内定位用(不加 ^):该行前缀只可能是引用符号/列表标记/空白,均不含 "[",首个命中即标记本身 */
const TODO_MARK = /\[([ xX])\] /;

/** 文档顺序收集任务标记所在的行号 */
function taskMarkLines(text: string): number[] {
  const tokens = md.parse(text, {});
  const lines: number[] = [];
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline.type !== 'inline') continue;
    if (tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
    if (!TODO_AT_START.test(inline.content)) continue;
    if (inline.map) lines.push(inline.map[0]);
  }
  return lines;
}

/** 按行切开但保留换行符:奇数下标是分隔符本身,重拼时 LF/CRLF 原样不动 */
function splitKeepEol(text: string): string[] {
  return text.split(/(\r\n|\n|\r)/);
}

/**
 * 切换第 index(0 起,文档顺序)个任务列表项的勾选态,返回新正文;
 * index 越界、非整数,或该处不是任务列表项时返回 null(调用方 no-op)。
 * 只改标记里的一个字符:行的其余内容、缩进、换行一个字节不动。
 */
export function toggleTaskAt(markdown: string, index: number): string | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const lines = taskMarkLines(markdown);
  if (index >= lines.length) return null;
  const parts = splitKeepEol(markdown);
  const at = lines[index] * 2;
  const line = parts[at];
  const mark = line === undefined ? null : TODO_MARK.exec(line);
  if (!mark) return null; // 防御:map 行必含标记,正常不可达
  const next = mark[1] === ' ' ? 'x' : ' ';
  parts[at] = line.slice(0, mark.index + 1) + next + line.slice(mark.index + 2);
  return parts.join('');
}

const TASK_INPUT = /<input\b[^>]*class="task-list-item-checkbox"[^>]*>/g;

/**
 * 交互态 HTML 后处理:给每个任务复选框按文档顺序写 data-task-index 并去掉 disabled。
 * 序号与 toggleTaskAt 的序号同源(都是文档顺序),组件层只认这个标记、不数 DOM 顺序;
 * 替换对象是本管线自产的 input 标签,写入值是自己生成的整数,不引入新的注入面。
 */
export function enableTaskCheckboxes(html: string): string {
  let index = 0;
  return html.replace(TASK_INPUT, (tag) => {
    const enabled = tag.replace(/\s+disabled(?:="")?/, '');
    return enabled.replace(/^<input\b/, `<input data-task-index="${index++}"`);
  });
}

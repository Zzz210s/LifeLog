/**
 * 笔记间显式链接 `[[标题]]` 的语法**镜像**(设计 D1/D2/D9),只用于前端渲染判断与 `[[` 补全的
 * 触发判断:保存与匹配一律以后端 `src-tauri/src/links.rs` 为准,前端不落库。
 * 跳过口径与标签扫描一致:围栏代码块整段跳过、行内代码里不算、`\` 转义不算。
 *
 * 与 Rust 的已知差异(刻意为之,见 fixtures/note-links.json 的共享向量只钉 raw_title 列表):
 * - `normalizeTitle` 里的标签词元剥离是**近似**:只删「行首/空白后 + `#` + 名称字符序列」,
 *   没有 Rust 的"库内已存在路径兜底",也不处理围栏状态(首行单行天然不在围栏里)。
 *   差异只影响极端写法下的显示判断,不影响入库的 raw_title/target_id。
 * - start/end 是 JS 的 UTF-16 下标(Rust 用字节),仅在本侧切片自洽。
 */

/** 一个已确认的链接区间(目标已裁首尾空白;display 是 `|` 之后的显示文本,设计 A5) */
export interface NoteLinkSpan {
  start: number;
  end: number;
  rawTitle: string;
  display: string | null;
}

/** 按**第一个** `|` 切分 `[[…]]` 的内容(设计 A1):目标是前段、显示是后段。
 *  两段都裁首尾空白;没有 `|` 或显示切完为空时 display 是 null(`[[甲|]]` 等价 `[[甲]]`,设计 A3) */
export function splitAlias(inner: string): { rawTitle: string; display: string | null } {
  const bar = inner.indexOf('|');
  if (bar < 0) return { rawTitle: inner.trim(), display: null };
  return { rawTitle: inner.slice(0, bar).trim(), display: inner.slice(bar + 1).trim() || null };
}

/** 标题长度上限(字符数,非字节),与 Rust `MAX_TITLE_CHARS` 同口径 */
export const MAX_TITLE_CHARS = 200;

/** 逐行维护围栏状态,与 Rust `link_spans` 的分行结构一一对应 */
export function noteLinkSpans(text: string): NoteLinkSpan[] {
  const spans: NoteLinkSpan[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const step = stepFence(fence, line);
    fence = step.next;
    if (!step.inside) scanLine(line, offset, spans);
    offset += rawLine.length + 1; // 加回被 split 吃掉的换行
  }
  return spans;
}

/** 围栏状态机的一步(与 Rust `link_spans` 同结构):返回该行是否「围栏内」(开/闭围栏行也算,
 *  因为 Rust 对围栏内的行整段不看)与推进后的围栏标记。`noteLinkSpans` 与补全触发判断共用。 */
function stepFence(fence: string | null, line: string): { inside: boolean; next: string | null } {
  const trimmed = line.trimStart();
  if (fence) return { inside: true, next: trimmed.startsWith(fence) ? null : fence };
  if (trimmed.startsWith('```')) return { inside: true, next: '```' };
  if (trimmed.startsWith('~~~')) return { inside: true, next: '~~~' };
  return { inside: false, next: null };
}

/** `pos` 所在行是否处在围栏代码块内(补全触发判断用:围栏内不弹候选) */
export function inFencedBlock(text: string, pos: number): boolean {
  let fence: string | null = null;
  let offset = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const step = stepFence(fence, line);
    if (pos <= offset + line.length) return step.inside;
    fence = step.next;
    offset += rawLine.length + 1;
  }
  return false;
}

/** 单行扫描骨架(围栏外的行):行内代码与 `\` 转义共用一份状态机,
 *  每个非代码区里的 `[[` 交给 `onOpen`,由它返回「下一个要处理的下标」(必须 > i)。
 *  链接解析与补全触发判断共用这一份,跳过口径不会漂移。 */
export function walkLine(line: string, onOpen: (i: number) => number): void {
  let inCode = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '\\') {
      i += 2; // 转义:反斜杠后的一个字符不作链接起点
      continue;
    }
    if (c === '`') {
      inCode = !inCode;
      i += 1;
      continue;
    }
    if (c === '[' && !inCode && line[i + 1] === '[') {
      i = onOpen(i);
      continue;
    }
    i += 1;
  }
}

/** 单行扫描:遇到 `[[` 用 parseAt 解析,失败就按 Rust 口径跳到闭合 `]]` 之后 */
function scanLine(line: string, base: number, out: NoteLinkSpan[]): void {
  walkLine(line, (i) => {
    const parsed = parseAt(line, i);
    if (parsed) {
      out.push({ start: base + i, end: base + parsed.end, rawTitle: parsed.rawTitle, display: parsed.display });
      return parsed.end;
    }
    // 整串不算:跳到闭合 `]]` 之后(嵌套里的 `[[` 不再重启)
    return skipPastClose(line, i + 2);
  });
}

/** 行片段里**未闭合**的 `[[` 起点(行片段 = 光标所在行从行首到光标的文本):
 *  走与 `link_spans` 同一套围栏外扫描(行内代码、转义、已闭合的合法链接整段吞掉),
 *  返回最后一个没被 `]]` 收尾的 `[[` 下标,没有则 -1。这是补全触发判断的语法核心。 */
export function lastUnclosedOpen(line: string): number {
  let last = -1;
  walkLine(line, (i) => {
    if (parseAt(line, i)) return skipPastClose(line, i + 2); // 已闭合的合法链接:整段吞掉
    if (line.indexOf(']]', i + 2) >= 0) return skipPastClose(line, i + 2); // 非法整串:同上
    last = i; // 未闭合:记为候选,继续往后找更近的
    return i + 2;
  });
  return last;
}

/** open 指向首个 `[`;成功返回闭 `]]` 之后的下标与切好的目标/显示。
 *  合法性只判**目标**:空目标(`[[|乙]]`)整串不算,`#` 开头的标签形(`[[#工作/]]`)不算(设计 §5.5),`|` 之后不参与判。 */
function parseAt(
  line: string,
  open: number
): { end: number; rawTitle: string; display: string | null } | null {
  const rest = line.slice(open + 2);
  const close = rest.indexOf(']]');
  if (close < 0) return null;
  const { rawTitle, display } = splitAlias(rest.slice(0, close));
  if (
    rawTitle === '' ||
    rawTitle.startsWith('#') ||
    [...rawTitle].length > MAX_TITLE_CHARS ||
    rawTitle.includes('[') ||
    rawTitle.includes(']')
  ) {
    return null;
  }
  return { end: open + 2 + close + 2, rawTitle, display };
}

/** 从 from 起跳过第一个 `]]`;没有闭合就跳到行尾 */
function skipPastClose(line: string, from: number): number {
  const rel = line.slice(from).indexOf(']]');
  return rel < 0 ? line.length : from + rel + 2;
}

/** 近似标签词元:行首或空白后的 `#` + 名称字符序列(差异见文件头) */
const TAG_TOKEN = /(^|\s)#[\p{L}\p{N}_\-][\p{L}\p{N}_\-/.]*/gu;
const ASCII_UPPER = /[A-Z]/g;

/** 首行归一化:剥近似标签词元 + 折叠连续空白 + ASCII 小写 */
export function normalizeTitle(line: string): string {
  return line
    .replace(TAG_TOKEN, '$1')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(ASCII_UPPER, (c) => c.toLowerCase());
}

/** 第一条非空行的归一化标题;整条空白返回空串 */
export function titleOf(content: string): string {
  for (const line of content.split('\n')) {
    if (line.trim() !== '') return normalizeTitle(line);
  }
  return '';
}

/** 第一条非空行的**显示**标题:只 trim,大小写与标签词元原样保留(与 Rust `display_title` 同口径) */
export function displayTitle(content: string): string {
  for (const line of content.split('\n')) {
    if (line.trim() !== '') return line.trim();
  }
  return '';
}

/**
 * 笔记间显式链接 `[[标题]]` 的语法**镜像**(设计 D1/D2/D9),只用于前端渲染判断:
 * 保存与匹配一律以后端 `src-tauri/src/links.rs` 为准,前端不落库。
 * 跳过口径与标签扫描一致:围栏代码块整段跳过、行内代码里不算、`\` 转义不算。
 *
 * 与 Rust 的已知差异(刻意为之,见 fixtures/note-links.json 的共享向量只钉 raw_title 列表):
 * - `normalizeTitle` 里的标签词元剥离是**近似**:只删「行首/空白后 + `#` + 名称字符序列」,
 *   没有 Rust 的"库内已存在路径兜底",也不处理围栏状态(首行单行天然不在围栏里)。
 *   差异只影响极端写法下的显示判断,不影响入库的 raw_title/target_id。
 * - start/end 是 JS 的 UTF-16 下标(Rust 用字节),仅在本侧切片自洽。
 */

/** 一个已确认的链接区间(标题已裁首尾空白) */
export interface NoteLinkSpan {
  start: number;
  end: number;
  rawTitle: string;
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
    const trimmed = line.trimStart();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
    } else if (trimmed.startsWith('```')) {
      fence = '```';
    } else if (trimmed.startsWith('~~~')) {
      fence = '~~~';
    } else {
      scanLine(line, offset, spans);
    }
    offset += rawLine.length + 1; // 加回被 split 吃掉的换行
  }
  return spans;
}

/** 单行扫描:维护行内代码与转义,遇到 `[[` 交给 parseAt */
function scanLine(line: string, base: number, out: NoteLinkSpan[]): void {
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
      const parsed = parseAt(line, i);
      if (parsed) {
        out.push({ start: base + i, end: base + parsed.end, rawTitle: parsed.title });
        i = parsed.end;
      } else {
        // 整串不算:跳到闭合 `]]` 之后(嵌套里的 `[[` 不再重启)
        i = skipPastClose(line, i + 2);
      }
      continue;
    }
    i += 1;
  }
}

/** open 指向首个 `[`;成功返回闭 `]]` 之后的下标与裁过首尾空白的标题。
 * `#` 开头的标签形(`[[#工作/]]`)与 Rust 一致地不算(设计 §5.5)。 */
function parseAt(line: string, open: number): { end: number; title: string } | null {
  const rest = line.slice(open + 2);
  const close = rest.indexOf(']]');
  if (close < 0) return null;
  const raw = rest.slice(0, close).trim();
  if (
    raw === '' ||
    raw.startsWith('#') ||
    [...raw].length > MAX_TITLE_CHARS ||
    raw.includes('[') ||
    raw.includes(']')
  ) {
    return null;
  }
  return { end: open + 2 + close + 2, title: raw };
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

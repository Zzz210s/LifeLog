/**
 * GFM 表格的"源码 <-> 格子"扫描层(纯函数,不碰 DOM、不写库)。
 *
 * 映射做法(设计 §2,自校验):
 *  1. 用 markdown-it 解析源码,取第 N 张表的 `table_open` token —— 它的 `map` 给出表格在源码里的
 *     行范围;同一 token 流里按行顺序能拿到每格的 `inline.content`(渲染层真正用的文本)。
 *  2. 在行范围内按 GFM 规则切行:未转义(前一个字符非 `\`)的 `|` 才是分隔,`\|` 是字面竖线,
 *     行首/行尾竖线可选。markdown-it 切列时会吃掉 `\|` 的一层反斜杠(见其 escapedSplit),
 *     故比对前对切出的原文做同款还原,才谈得上"逐格相等"。
 *  3. 自校验:切出来的格子文本序列必须与 token 序列逐格相等(缺格补齐、多格忽略后仍不等)-> 返回
 *     null,调用方据此退化成"进整条笔记编辑"。绝不猜。
 *  4. 命中后每格给出源码字符区间 [start, end)(含该格两侧空白,不含分隔竖线)。
 *
 * 已知边界:行内代码里含 `|`、嵌套在引用/列表里的表 —— 自校验对不上就整表返回 null。
 * 结构改写(增删行列)在 md-table.ts。
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt();

export interface TableRange {
  /** 表格首行行首在源码里的字符偏移 */
  start: number;
  /** 表格末行行尾(不含换行)在源码里的字符偏移 */
  end: number;
  /** 表格各行原文(不含换行):[表头, 分隔行, ...数据行] */
  lines: string[];
}

export interface CellSpan {
  /** 表内行号:0 = 表头,>= 1 = 数据行 */
  row: number;
  col: number;
  start: number;
  end: number;
  /** 格子文本(去两侧空白、还原 `\|` 后的 markdown 源文本,与渲染层 token 一致) */
  text: string;
}

/** 每行内容区间(不含行尾换行);把 markdown-it 的 map 行号换算成源码字符偏移 */
export function lineSpans(source: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= source.length; i++) {
    const ch = source.charCodeAt(i);
    if (i === source.length || ch === 10 || ch === 13) {
      out.push({ start, end: i });
      if (ch === 13 && source.charCodeAt(i + 1) === 10) i++; // CRLF 一起吃掉
      start = i + 1;
    }
  }
  return out;
}

/** 一行按未转义 `|` 切成片段(含各片段在行内的偏移);未转义 = 前一个字符不是 `\` */
export function splitSegments(line: string): { text: string; offset: number }[] {
  const segs: { text: string; offset: number }[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) === 124 && line.charCodeAt(i - 1) !== 92) {
      segs.push({ text: line.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  segs.push({ text: line.slice(start), offset: start });
  return segs;
}

export interface RawRow {
  cells: { text: string; offset: number }[];
  lead: boolean;
  trail: boolean;
}

/** 切一行并去掉行首/行尾那个"空片段"(= 首尾竖线),与 markdown-it 的 shift/pop 对齐 */
export function rowRaw(line: string): RawRow {
  const segs = splitSegments(line);
  const lead = segs[0].text === '';
  const trail = segs[segs.length - 1].text === '';
  return { cells: segs.slice(lead ? 1 : 0, trail ? segs.length - 1 : segs.length), lead, trail };
}

/** 行内容与去空白后的起偏移 */
export function trimmed(line: string): { text: string; base: number } {
  const a = /^\s*/.exec(line)![0].length;
  const b = line.replace(/\s+$/, '').length;
  return { text: line.slice(a, b), base: a };
}

/** 与 markdown-it escapedSplit 同款:吃掉转义竖线前的一层反斜杠 */
export const unescapePipe = (s: string): string => s.replace(/\\\|/g, '|');

/** 归一化一格用于自校验:去空白 + 还原转义竖线 */
export const norm = (raw: string): string => unescapePipe(raw.trim());

/** 取 range 对应的那张表在 token 流里的逐行格子文本(表头行 + 每个数据行);找不到返回 null */
function tokenRows(source: string, range: TableRange): string[][] | null {
  const spans = lineSpans(source);
  const tokens = md.parse(source, {});
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'table_open' || !t.map) continue;
    if (spans[t.map[0]].start !== range.start) continue;
    const rows: string[][] = [];
    let cur: string[] | null = null;
    for (let j = i + 1; j < tokens.length; j++) {
      const tk = tokens[j];
      if (tk.type === 'table_close') break;
      if (tk.type === 'tr_open') rows.push((cur = []));
      else if (tk.type === 'inline' && cur) cur.push(tk.content);
    }
    return rows;
  }
  return null;
}

/** 文档顺序里第 index(0 起)张表的行范围;越界或源码里没有该表时返回 null */
export function locateTable(source: string, index: number): TableRange | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const spans = lineSpans(source);
  let seen = -1;
  for (const t of md.parse(source, {})) {
    if (t.type !== 'table_open' || !t.map) continue;
    if (++seen !== index) continue;
    const [from, to] = t.map;
    if (from >= spans.length || to > spans.length || to <= from) return null;
    const lines: string[] = [];
    for (let l = from; l < to; l++) lines.push(source.slice(spans[l].start, spans[l].end));
    return { start: spans[from].start, end: spans[to - 1].end, lines };
  }
  return null;
}

/** 表格每格在源码里的 span;自校验失败(切分与 markdown-it 对不上)返回 null */
export function tableCells(source: string, range: TableRange): CellSpan[] | null {
  if (range.lines.length < 2) return null;
  const rows = tokenRows(source, range);
  if (!rows) return null;
  const spans = lineSpans(source);
  const from = spans.findIndex((s) => s.start === range.start);
  if (from < 0) return null;
  const cols = rows[0].length;
  if (cols === 0 || rows.length !== range.lines.length - 1) return null;
  const out: CellSpan[] = [];
  for (let r = 0; r < rows.length; r++) {
    const li = r === 0 ? from : from + r + 1; // r>=1 要跳过 range.lines[1] 的分隔行
    const line = source.slice(spans[li].start, spans[li].end);
    const { text, base } = trimmed(line);
    const { cells } = rowRaw(text);
    if (r === 0 && cells.length !== cols) return null; // 表头列数必须严格相等
    const origin = spans[li].start + base;
    let lastEnd = origin;
    for (let c = 0; c < cols; c++) {
      const seg = cells[c];
      if (seg === undefined) {
        // 缺格:补一个空 span(物化点 = 上一格末尾),与 markdown-it 的空补齐对齐
        if (rows[r][c] !== '') return null;
        out.push({ row: r, col: c, start: lastEnd, end: lastEnd, text: '' });
        continue;
      }
      const start = origin + seg.offset;
      lastEnd = start + seg.text.length;
      const value = norm(seg.text);
      if (value !== rows[r][c]) return null; // 自校验:逐格相等
      out.push({ row: r, col: c, start, end: lastEnd, text: value });
    }
  }
  return out;
}

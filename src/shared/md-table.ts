/**
 * GFM 表格的改写层:单格替换 + 增删行列(纯函数,不碰 DOM、不写库)。
 * 扫描层(源码 <-> 格子映射与自校验)在 md-table-scan.ts,这里只做文本改写。
 *
 * 结构改写都走同一个"重写整张表"路径:按 TableRange 取回表头/分隔行/数据行 -> 改结构 -> 拼回源码,
 * 保证表头/分隔行/数据行的列数始终一致;其余格子的原文逐字节保留(只新增/删除目标格)。
 */
import { rowRaw, type TableRange, type CellSpan } from './md-table-scan';

export type { TableRange, CellSpan } from './md-table-scan';
export { locateTable, tableCells, lineSpans } from './md-table-scan';

/** 把新值写成源码里的格子文本:字面竖线转义,GFM 惯例两侧各留一个空格 */
const writeCell = (text: string): string => ` ${text.replace(/\|/g, '\\|')} `;

/** 只改这一格,其余源码逐字节不变;cell 是缺格(空 span)时就地物化一格 */
export function replaceCell(source: string, cell: CellSpan, text: string): string {
  const value = writeCell(text);
  const head = source.slice(0, cell.start);
  const tail = source.slice(cell.end);
  return cell.start === cell.end ? `${head}|${value}${tail}` : head + value + tail;
}

interface Block {
  header: string;
  delim: string;
  rows: string[];
}

const parseBlock = (range: TableRange): Block => ({
  header: range.lines[0] ?? '',
  delim: range.lines[1] ?? '',
  rows: range.lines.slice(2),
});

/** 表格块的换行风格(取表格末尾那一个;表格在文末则回看全文) */
function eolOf(source: string, range: TableRange): string {
  const after = source.slice(range.end, range.end + 2);
  if (after.startsWith('\r\n')) return '\r\n';
  if (after.startsWith('\n')) return '\n';
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/** 用新结构重写整张表并拼回源码 */
function rebuild(source: string, range: TableRange, block: Block): string {
  const eol = eolOf(source, range);
  const text = [block.header, block.delim, ...block.rows].join(eol);
  return source.slice(0, range.start) + text + source.slice(range.end);
}

/** 由片段重建一行(保留原首尾竖线风格) */
const buildRow = (cells: string[], lead: boolean, trail: boolean): string =>
  `${lead ? '|' : ''}${cells.join('|')}${trail ? '|' : ''}`;

/** 取一行补齐/截断到 count 格(结构改写用;不改已有格的原文,只补空) */
function fitCells(line: string, count: number): { cells: string[]; lead: boolean; trail: boolean } {
  const { cells, lead, trail } = rowRaw(line.trim());
  const next = cells.map((c) => c.text).slice(0, count);
  while (next.length < count) next.push('  ');
  return { cells: next, lead, trail };
}

/** 在当前数据行下方插入一行空行;at = -1 表示插到第一行数据行之前 */
export function insertRow(source: string, range: TableRange, at: number): string {
  const block = parseBlock(range);
  const cols = rowRaw(block.header.trim()).cells.length;
  const idx = at + 1;
  if (cols === 0 || !Number.isInteger(at) || idx < 0 || idx > block.rows.length) return source;
  block.rows.splice(idx, 0, buildRow(Array(cols).fill('  '), true, true));
  return rebuild(source, range, block);
}

/** 删除第 at(0 起,数据行)行 */
export function deleteRow(source: string, range: TableRange, at: number): string {
  const block = parseBlock(range);
  if (!Number.isInteger(at) || at < 0 || at >= block.rows.length) return source;
  block.rows.splice(at, 1);
  return rebuild(source, range, block);
}

/** 在第 at 列右侧插入一列:表头补空标题、分隔行补 ---、每个数据行补空 */
export function insertColumn(source: string, range: TableRange, at: number): string {
  const block = parseBlock(range);
  const cols = rowRaw(block.header.trim()).cells.length;
  if (!Number.isInteger(at) || at < 0 || at >= cols) return source;
  const widen = (line: string, filler: string): string => {
    const { cells, lead, trail } = fitCells(line, cols);
    cells.splice(at + 1, 0, filler);
    return buildRow(cells, lead, trail);
  };
  block.header = widen(block.header, '  ');
  block.delim = widen(block.delim, ' --- ');
  block.rows = block.rows.map((r) => widen(r, '  '));
  return rebuild(source, range, block);
}

/** 删除第 at 列(表头/分隔行/数据行同步);至少保留一列 */
export function deleteColumn(source: string, range: TableRange, at: number): string {
  const block = parseBlock(range);
  const cols = rowRaw(block.header.trim()).cells.length;
  if (!Number.isInteger(at) || at < 0 || at >= cols || cols <= 1) return source;
  const narrow = (line: string): string => {
    const { cells, lead, trail } = fitCells(line, cols);
    cells.splice(at, 1);
    return buildRow(cells, lead, trail);
  };
  block.header = narrow(block.header);
  block.delim = narrow(block.delim);
  block.rows = block.rows.map(narrow);
  return rebuild(source, range, block);
}

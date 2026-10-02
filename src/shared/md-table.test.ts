import { describe, expect, it } from 'vitest';
import {
  locateTable,
  tableCells,
  replaceCell,
  insertRow,
  insertColumn,
  deleteRow,
  deleteColumn,
} from './md-table';

const T = '| a | b |\n| --- | --- |\n| 1 | 2 |';

/** 定位第 index 张表并取格(自校验失败会抛,便于用例直接看到) */
function cells(src: string, index = 0) {
  const range = locateTable(src, index);
  expect(range).not.toBeNull();
  const list = tableCells(src, range!);
  expect(list).not.toBeNull();
  return list!;
}

const texts = (list: { text: string }[]) => list.map((c) => c.text);
const rowTexts = (src: string, row: number) => texts(cells(src).filter((c) => c.row === row));

describe('locateTable', () => {
  it('取第 0 张表的行范围,字符区间正好覆盖整张表', () => {
    const r = locateTable(T, 0)!;
    expect(r.lines).toEqual(['| a | b |', '| --- | --- |', '| 1 | 2 |']);
    expect(T.slice(r.start, r.end)).toBe(T);
  });

  it('表格前后有其它内容时字符区间仍正确', () => {
    const src = `前言\n\n${T}\n\n后记\n`;
    const r = locateTable(src, 0)!;
    expect(src.slice(r.start, r.end)).toBe(T);
    expect(r.start).toBe('前言\n\n'.length);
  });

  it('按文档顺序取第 N 张表,越界返回 null', () => {
    const src = `${T}\n\n| x |\n| --- |\n| y |`;
    expect(locateTable(src, 1)!.lines[0]).toBe('| x |');
    expect(locateTable(src, 2)).toBeNull();
  });

  it('围栏代码块里的"表格"不算,表索引不受它影响', () => {
    const src = '```\n| fake | tbl |\n| --- | --- |\n```\n\n' + T;
    expect(locateTable(src, 0)!.lines[0]).toBe('| a | b |');
    expect(locateTable(src, 1)).toBeNull();
  });

  it('缩进 4 空格的行是代码块,不成表', () => {
    expect(locateTable('    | a | b |\n    | --- | --- |', 0)).toBeNull();
  });

  it('index 非自然数返回 null', () => {
    expect(locateTable(T, -1)).toBeNull();
    expect(locateTable(T, 1.5)).toBeNull();
  });
});

describe('tableCells', () => {
  it('普通表:行/列与文本正确,span 指回源码', () => {
    const list = cells(T);
    expect(list.map((c) => [c.row, c.col, c.text])).toEqual([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [1, 0, '1'],
      [1, 1, '2'],
    ]);
    for (const c of list) expect(T.slice(c.start, c.end).trim()).toBe(c.text);
  });

  it('分隔行不是数据格', () => {
    const list = cells(T);
    expect(list.some((c) => c.text.includes('---'))).toBe(false);
    expect([...new Set(list.map((c) => c.row))]).toEqual([0, 1]);
  });

  it('\\| 是字面竖线,不拆列;span 仍指回带反斜杠的源码', () => {
    const src = '| a | b |\n| --- | --- |\n| x \\| y | z |';
    const list = cells(src);
    expect(texts(list)).toEqual(['a', 'b', 'x | y', 'z']);
    expect(src.slice(list[2].start, list[2].end)).toBe(' x \\| y ');
  });

  it('缺格补齐:空文本、零宽 span', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 |';
    const list = cells(src);
    expect(texts(list)).toEqual(['a', 'b', '1', '']);
    expect(list[3].start).toBe(list[3].end);
  });

  it('多格忽略:只取表头列数那么多个', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 | 3 |';
    expect(texts(cells(src))).toEqual(['a', 'b', '1', '2']);
  });

  it('空单元格', () => {
    const src = '| a | b |\n| --- | --- |\n|  |  |';
    expect(texts(cells(src))).toEqual(['a', 'b', '', '']);
  });

  it('自校验:切分与 markdown-it 对不上就返回 null(引用里的表)', () => {
    const src = '> | a | b |\n> | --- | --- |\n> | 1 | 2 |';
    const r = locateTable(src, 0);
    expect(r).not.toBeNull();
    expect(tableCells(src, r!)).toBeNull();
  });
});

describe('replaceCell', () => {
  it('只改那一格,其余源码逐字节不变', () => {
    const src = `前言\n\n${T}\n\n后记\n`;
    const target = cells(src).find((c) => c.row === 1 && c.col === 0)!;
    const out = replaceCell(src, target, '9');
    expect(out).toBe('前言\n\n| a | b |\n| --- | --- |\n| 9 | 2 |\n\n后记\n');
    expect(out.slice(0, target.start)).toBe(src.slice(0, target.start));
    expect(out.slice(target.start + ' 9 '.length)).toBe(src.slice(target.end));
  });

  it('新值里的竖线转义后写回,再解析仍是同一文本', () => {
    const out = replaceCell(T, cells(T)[3], 'a | b');
    expect(out).toBe('| a | b |\n| --- | --- |\n| 1 | a \\| b |');
    expect(texts(cells(out))).toEqual(['a', 'b', '1', 'a | b']);
  });

  it('改缺格时就地物化一格', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 |';
    const missing = cells(src)[3];
    expect(replaceCell(src, missing, '9')).toBe('| a | b |\n| --- | --- |\n| 1 | 9 |');
  });
});

describe('结构改写', () => {
  const S = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';

  it('insertRow:在当前行下方插空行,列数与其余数据不变', () => {
    const out = insertRow(T, locateTable(T, 0)!, 0);
    expect([...new Set(cells(out).map((c) => c.row))]).toEqual([0, 1, 2]);
    expect(rowTexts(out, 1)).toEqual(['1', '2']);
    expect(rowTexts(out, 2)).toEqual(['', '']);
  });

  it('insertRow at=-1:插到第一行数据行之前', () => {
    const out = insertRow(T, locateTable(T, 0)!, -1);
    expect(rowTexts(out, 1)).toEqual(['', '']);
    expect(rowTexts(out, 2)).toEqual(['1', '2']);
  });

  it('insertRow:at 越界时原样返回', () => {
    expect(insertRow(T, locateTable(T, 0)!, 5)).toBe(T);
  });

  it('insertColumn:每行列数 +1,分隔行同步,其余数据不动', () => {
    const out = insertColumn(S, locateTable(S, 0)!, 0);
    expect(rowTexts(out, 0)).toEqual(['a', '', 'b']);
    expect(rowTexts(out, 1)).toEqual(['1', '', '2']);
    expect(rowTexts(out, 2)).toEqual(['3', '', '4']);
    expect(out.split('\n')[1]).toBe('| --- | --- | --- |');
  });

  it('deleteRow:数据行 -1,其余数据不动', () => {
    const out = deleteRow(S, locateTable(S, 0)!, 0);
    expect([...new Set(cells(out).map((c) => c.row))]).toEqual([0, 1]);
    expect(rowTexts(out, 1)).toEqual(['3', '4']);
  });

  it('deleteColumn:每行列数 -1,分隔行同步,其余数据不动', () => {
    const out = deleteColumn(S, locateTable(S, 0)!, 0);
    expect(rowTexts(out, 0)).toEqual(['b']);
    expect(rowTexts(out, 1)).toEqual(['2']);
    expect(rowTexts(out, 2)).toEqual(['4']);
    expect(out.split('\n')[1]).toBe('| --- |');
  });

  it('deleteColumn:只剩一列时不动', () => {
    const one = '| a |\n| --- |\n| 1 |';
    expect(deleteColumn(one, locateTable(one, 0)!, 0)).toBe(one);
  });

  it('CRLF 源码改写后仍是 CRLF', () => {
    const crlf = '| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n';
    const out = insertRow(crlf, locateTable(crlf, 0)!, 0);
    expect(out).toBe('| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n|  |  |\r\n');
  });
});

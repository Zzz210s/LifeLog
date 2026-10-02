// @vitest-environment jsdom
// jsdom:DOMPurify 净化需要真实 DOM;此处的重点是表格结构/对齐/内联/转义口径。
// 表格的视觉(行高/斑马纹/悬停/宽表滚动)是 CSS 层,由真机门禁 scripts/audit-table-style.mjs 覆盖。
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';
import type { NoteLink } from './types';

const link = (rawTitle: string, targetId: number | null, title: string | null): NoteLink => ({ rawTitle, targetId, title });
/** 数某个标签的元素个数(本文件只用无属性的 th/td,'<' + 标签 + '>' 足够) */
const count = (html: string, tag: 'th' | 'td') => html.split(`<${tag}>`).length - 1;

describe('GFM 表格:结构与对齐', () => {
  it('渲染 table/thead/th/tbody/td', () => {
    const html = renderMarkdown('| 列A | 列B |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>列A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('对齐三态经 style 属性穿透净化(数字列右对齐由作者用 ---: 控制,组件不写对齐 CSS)', () => {
    const html = renderMarkdown('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |');
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<th style="text-align:center">b</th>');
    expect(html).toContain('<th style="text-align:right">c</th>');
    expect(html).toContain('<td style="text-align:right">3</td>');
  });

  it('空单元格输出 <td></td>,不塌成自闭合', () => {
    const html = renderMarkdown('| 空 | 值 |\n| --- | --- |\n|  |  |');
    expect(html).toContain('<td></td>');
    expect(html).not.toContain('<td/>');
  });

  it('宽表 8 列渲出 8 个 th 与 8 个 td(横向滚动是 CSS 层,真机门禁覆盖)', () => {
    const head = Array.from({ length: 8 }, (_, i) => `列${i + 1}`).join(' | ');
    const body = Array.from({ length: 8 }, (_, i) => String(i + 1)).join(' | ');
    const html = renderMarkdown(`| ${head} |\n| ${Array(8).fill('---').join(' | ')} |\n| ${body} |`);
    expect(count(html, 'th')).toBe(8);
    expect(count(html, 'td')).toBe(8);
  });
});

describe('GFM 表格:单元格内联', () => {
  it('粗体与行内代码在单元格里生效', () => {
    const html = renderMarkdown('| 甲 |\n| --- |\n| **粗** `码` |');
    expect(html).toContain('<td><strong>粗</strong> <code>码</code></td>');
  });

  it('[[链接]] chip 在单元格里渲染(需传 links)', () => {
    const html = renderMarkdown('| 甲 |\n| --- |\n| 见 [[目标]] |', [link('目标', 7, '目标(改)')]);
    expect(html).toContain('data-note-link="7"');
    expect(html).toContain('>目标(改)</span>');
  });
});

describe('GFM 表格:转义与围栏', () => {
  it('围栏代码块里的 | --- | 不渲染成 table', () => {
    const html = renderMarkdown('```\n| a | b |\n| --- | --- |\n```');
    expect(html).not.toContain('<table>');
  });

  it('单元格里的竖线写 \\|(或 &#124;)即得字面竖线,不拆列', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| x \\| y | &#124; |');
    expect(html).toContain('<td>x | y</td>');
    expect(html).toContain('<td>|</td>');
    expect(count(html, 'td')).toBe(2);
  });

  it('已知限制:未转义的竖线会被当分列符,多出的单元格被丢弃', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| x | y | z |');
    expect(count(html, 'td')).toBe(2);
  });
});

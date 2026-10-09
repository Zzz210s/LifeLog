// @vitest-environment jsdom
// jsdom:renderMarkdown 的 DOMPurify 与 noteLinkFrom 的 Element 都需要真实 DOM
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';
import { noteLinkEnv, noteLinkFrom, renderNoteLink } from './note-link';
import { normalizeTitle } from './note-link-syntax';
import type { NoteLink } from './types';

const link = (rawTitle: string, targetId: number | null, title: string | null): NoteLink => ({
  rawTitle,
  targetId,
  title,
});

describe('renderNoteLink:两种样式的 chip', () => {
  it('已解析:accent 实线 + data-note-link=id + 目标当前首行', () => {
    const html = renderNoteLink('旧标题', { id: 7, title: '目标笔记' });
    expect(html).toContain('data-note-link="7"');
    expect(html).toContain('text-accent');
    expect(html).not.toContain('decoration-dashed');
    expect(html).toContain('>目标笔记</span>');
  });

  it('未解析:muted 虚线 + 空 data-note-link + 正文原文', () => {
    const html = renderNoteLink('不存在的标题', null);
    expect(html).toContain('data-note-link=""');
    expect(html).toContain('text-muted');
    expect(html).toContain('decoration-dashed');
    expect(html).toContain('>不存在的标题</span>');
  });

  it('标题转义：不注入元素', () => {
    const html = renderNoteLink('<b>x</b>', null);
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });
});

describe('renderNoteLink:别名(设计 A5)', () => {
  it('有别名时 chip 文字用显示文本，title 给目标标题', () => {
    const html = renderNoteLink('目标', { id: 7, title: '目标笔记' }, '我自己的说法');
    expect(html).toContain('>我自己的说法</span>');
    expect(html).toContain('title="目标笔记"');
    expect(html).toContain('data-note-link="7"');
    expect(html).toContain('data-note-link-raw="目标"');
  });

  it('空别名(display=null)回落成目标标题，与无别名一致', () => {
    expect(renderNoteLink('甲', { id: 7, title: '甲改' }, null)).toContain('>甲改</span>');
    expect(renderNoteLink('甲', { id: 7, title: '甲改' })).toContain('>甲改</span>');
  });

  it('未解析带别名：chip 文字=显示文本，title 与 raw 都是目标', () => {
    const html = renderNoteLink('不存在', null, '随便什么');
    expect(html).toContain('data-note-link=""');
    expect(html).toContain('decoration-dashed');
    expect(html).toContain('>随便什么</span>');
    expect(html).toContain('title="不存在"');
    expect(html).toContain('data-note-link-raw="不存在"');
  });

  it('别名里的引号被转义', () => {
    const html = renderNoteLink('甲', null, '说"引号"');
    expect(html).toContain('&quot;引号&quot;');
  });
});

describe('noteLinkFrom:点击命中', () => {
  const mount = (attrs: string, text: string): HTMLElement => {
    document.body.innerHTML = `<p>前 <span ${attrs}>${text}</span> 后</p>`;
    return document.querySelector('span') as HTMLElement;
  };

  it('已解析 chip -> id 与文本', () => {
    const el = mount('data-note-link="12"', '目标');
    expect(noteLinkFrom(el)).toEqual({ id: 12, title: '目标' });
  });

  it('未解析 chip -> id 为 null,title 是正文原文', () => {
    const el = mount('data-note-link=""', '没有的');
    expect(noteLinkFrom(el)).toEqual({ id: null, title: '没有的' });
  });

  it('带 data-note-link-raw 时优先用它(预填目标而非显示文本)', () => {
    const el = mount('data-note-link="" data-note-link-raw="目标"', '我自己的说法');
    expect(noteLinkFrom(el)).toEqual({ id: null, title: '目标' });
  });

  it('子节点命中也算(最近祖先),非 chip 返回 null', () => {
    const el = mount('data-note-link="3"', '<em>目标</em>');
    expect(noteLinkFrom(el.querySelector('em'))).toEqual({ id: 3, title: '目标' });
    expect(noteLinkFrom(document.querySelector('p'))).toBeNull();
  });
});

describe('noteLinkEnv:归一化键', () => {
  it('已解析进 Map(键归一化),未解析不进', () => {
    const env = noteLinkEnv([link('Hello World', 5, 'Hello World'), link('没有的', null, null)]);
    expect(env.links?.get(normalizeTitle('hello   world'))).toEqual({ id: 5, title: 'Hello World' });
    expect(env.links?.size).toBe(1);
    expect(noteLinkEnv(undefined).links).toBeUndefined();
  });
});

describe('正文渲染里的 chip(与 L1 解析口径一致)', () => {
  it('已解析 -> accent chip,文本用目标当前首行(改名跟随)', () => {
    const html = renderMarkdown('看 [[目标笔记]] 那条', [link('目标笔记', 7, '目标笔记(改)')]);
    expect(html).toContain('data-note-link="7"');
    expect(html).toContain('>目标笔记(改)</span>');
  });

  it('大小写/连续空白差异靠归一化对上', () => {
    const html = renderMarkdown('看 [[hello   world]]', [link('Hello World', 5, 'Hello World')]);
    expect(html).toContain('data-note-link="5"');
  });

  it('未解析 -> muted 虚线 chip(空 id)', () => {
    const html = renderMarkdown('看 [[没有的]] 那条', []);
    expect(html).toContain('data-note-link=""');
    expect(html).toContain('decoration-dashed');
    expect(html).toContain('>没有的</span>');
  });

  it('不传 links(只读预览)时 [[]] 原样文本,不产生 chip', () => {
    const html = renderMarkdown('看 [[目标笔记]] 那条');
    expect(html).not.toContain('data-note-link');
    expect(html).toContain('[[目标笔记]]');
  });

  it('围栏代码块 / 行内代码 / 转义里不渲成 chip(设计 §4 与 L1 同步)', () => {
    for (const src of ['```\n[[甲]]\n```', '`[[甲]]`', '\\[[甲]]']) {
      expect(renderMarkdown(src, [link('甲', 1, '甲')]), src).not.toContain('data-note-link');
    }
  });

  it('非法整串保持字面:空 / 标签形 / 嵌套 / 跨行', () => {
    for (const src of ['[[]]', '[[#工作/]]', '[[甲[[乙]]', '[[甲\n乙]]']) {
      expect(renderMarkdown(src, []), src).not.toContain('data-note-link');
    }
  });

  it('常规 markdown 链接不受影响', () => {
    const html = renderMarkdown('[官网](https://example.com)', [link('官网', 1, '官网')]);
    expect(html).toContain('<a');
    expect(html).not.toContain('data-note-link');
  });

  it('别名:chip 文字用显示文本,data-note-link 仍是目标 id', () => {
    const html = renderMarkdown('看 [[目标笔记|我自己的说法]]', [link('目标笔记', 7, '目标笔记')]);
    expect(html).toContain('data-note-link="7"');
    expect(html).toContain('>我自己的说法</span>');
    expect(html).toContain('title="目标笔记"');
  });

  it('别名目标是目标段落:匹配用 `|` 之前那段(显示文本不参与解析)', () => {
    const html = renderMarkdown('[[甲|乙]]', [link('甲', 1, '甲')]);
    expect(html).toContain('data-note-link="1"');
    expect(html).toContain('>乙</span>');
    // 显示文本正是另一个条目时也不会解析到它
    const other = renderMarkdown('[[甲|乙]]', [link('乙', 2, '乙')]);
    expect(other).toContain('data-note-link=""');
  });

  it('多个竖线:显示文本是第一个 `|` 之后的全部', () => {
    const html = renderMarkdown('[[甲|乙|丙]]', [link('甲', 1, '甲')]);
    expect(html).toContain('>乙|丙</span>');
  });

  it('空别名回落目标标题;空目标整串不渲染', () => {
    expect(renderMarkdown('[[甲|]]', [link('甲', 1, '甲改')])).toContain('>甲改</span>');
    expect(renderMarkdown('[[|乙]]', [])).not.toContain('data-note-link');
  });

  it('未解析带别名:chip 文字=显示文本,点击预填目标', () => {
    const html = renderMarkdown('看 [[不存在|随便什么]] 那条', []);
    expect(html).toContain('data-note-link=""');
    expect(html).toContain('data-note-link-raw="不存在"');
    expect(html).toContain('>随便什么</span>');
  });

  it('围栏代码块里的别名不渲染成 chip', () => {
    expect(renderMarkdown('```\n[[甲|乙]]\n```', [link('甲', 1, '甲')])).not.toContain('data-note-link');
  });
});

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

  it('标题转义:不注入元素', () => {
    const html = renderNoteLink('<b>x</b>', null);
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
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
});

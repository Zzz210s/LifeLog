// @vitest-environment jsdom
// jsdom:DOMPurify 净化需要真实 DOM;此处 node 默认环境跑不了
import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderMarkdownInteractive, sanitize } from './markdown';
import { toggleTaskAt } from './md-task';

describe('renderMarkdown 基础渲染', () => {
  it('h1/h2 标题层级', () => {
    const html = renderMarkdown('# 标题一\n\n## 标题二');
    expect(html).toContain('<h1>标题一</h1>');
    expect(html).toContain('<h2>标题二</h2>');
  });

  it('GFM 表格渲染 table 与 th', () => {
    const html = renderMarkdown('| 列A | 列B |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>列A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('任务列表渲染禁用复选框并带类名', () => {
    const html = renderMarkdown('- [ ] 买牛奶');
    expect(html).toContain('task-list-item');
    expect(html).toContain('<input');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('disabled');
  });

  it('Markdown 完成态 - [x] 同样渲染为禁用的已勾选复选框(S5 唯一的完成表达)', () => {
    const html = renderMarkdown('- [x] 已完成的买牛奶');
    expect(html).toContain('task-list-item');
    expect(html).toContain('checked');
    expect(html).toContain('disabled');
  });

  it('删除线 ~~x~~ 渲染 del', () => {
    expect(renderMarkdown('~~过时~~内容')).toContain('<del>过时</del>');
  });

  it('围栏代码块获得 hljs 与语言类名并高亮', () => {
    const html = renderMarkdown('```ts\nconst n: number = 1;\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('hljs language-ts');
    expect(html).toContain('hljs-keyword'); // const 被标记为关键字
  });

  it('未知语言代码块安全转义仍带语言类名', () => {
    const html = renderMarkdown('```foobarlang\n<script>\n```');
    expect(html).toContain('language-foobarlang');
    expect(html).not.toContain('<script>');
  });

  it('外链 http(s) 图片允许渲染', () => {
    const html = renderMarkdown('![示意图](https://example.com/i.png)');
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/i.png"');
    expect(html).toContain('alt="示意图"');
  });
});

describe('外链安全与有序列表起始值', () => {
  it('linkify 裸 URL 链接带 target 与 rel 隔离', () => {
    const html = renderMarkdown('参考 https://example.com/a?b=1 结束');
    expect(html).toContain('<a');
    expect(html).toContain('href="https://example.com/a?b=1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('显式 markdown 链接同样带安全属性', () => {
    const html = renderMarkdown('[官网](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('sanitize 直接净化 raw a 也补安全属性', () => {
    const html = sanitize('<a href="https://example.com">x</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('起始非 1 的有序列表保留 start 属性', () => {
    const html = renderMarkdown('3. 第三项');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<li>第三项</li>');
  });
});

describe('XSS 净化', () => {
  it('script 标签被转义并净化', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(sanitize('<script>alert(1)</script>')).not.toContain('script');
  });

  it('onerror 属性被剥离', () => {
    const html = sanitize('<img src="https://x/i.png" onerror="alert(1)">');
    expect(html).toContain('src="https://x/i.png"');
    expect(html).not.toContain('onerror');
  });

  it('javascript: 链接被中和', () => {
    // markdown-it 层即拒绝该链接(validateLink),仅剩惰性文本
    const html = renderMarkdown('[点我](javascript:alert(1))');
    expect(html).toContain('点我');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
    // DOMPurify 层独立验证:raw html 注入的 javascript: href 被剥离
    const neutralized = sanitize('<a href="javascript:alert(1)">点我</a>');
    expect(neutralized).not.toContain('javascript:');
  });
});

/** 多形态文档:普通项/续行/围栏代码/有序/引用块 混排 */
const TASK_DOC = [
  '# 标题',
  '',
  '- 普通项',
  '- [ ] 一',
  '  续行 `- [ ] 伪`',
  '',
  '```',
  '- [ ] 代码里的',
  '```',
  '',
  '1) [x] 二',
  '',
  '> - [X] 三',
].join('\n');

/** 按文档顺序取出 HTML 里复选框的勾选态 */
function boxStates(html: string): boolean[] {
  return [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0].includes('checked'));
}

describe('交互态渲染与源码索引对齐', () => {
  it('读视图:复选框解开 disabled 并按文档顺序带 data-task-index', () => {
    const html = renderMarkdownInteractive(TASK_DOC);
    expect(html).not.toContain('disabled');
    expect(html).toContain('data-task-index="0"');
    expect(html).toContain('data-task-index="1"');
    expect(html).toContain('data-task-index="2"');
    expect(html).not.toContain('data-task-index="3"');
    // 只读渲染产物无序号可点(任务态以正文为准,不靠原生复选框控件)
    const readonly = renderMarkdown(TASK_DOC);
    expect(readonly).toContain('disabled');
    expect(readonly).not.toContain('data-task-index');
  });

  it('勾选第 i 项只翻第 i 个复选框,再点一次回到原文(索引与渲染同序)', () => {
    const before = boxStates(renderMarkdownInteractive(TASK_DOC));
    expect(before).toEqual([false, true, true]);
    before.forEach((state, i) => {
      const next = toggleTaskAt(TASK_DOC, i);
      expect(next).not.toBeNull();
      const after = boxStates(renderMarkdownInteractive(next!));
      expect(after[i]).toBe(!state);
      after.forEach((s, j) => {
        if (j !== i) expect(s).toBe(before[j]);
      });
      // 再点一次回到原语义态([X] 会归一为 [x],故比对渲染结果而非原文)
      expect(boxStates(renderMarkdownInteractive(toggleTaskAt(next!, i)!))).toEqual(before);
    });
  });

  it('小写形态下双击回到原文字节一致', () => {
    const src = '- [ ] a\n- [x] b';
    expect(toggleTaskAt(toggleTaskAt(src, 0)!, 0)).toBe(src);
  });
});

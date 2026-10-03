// @vitest-environment jsdom
/**
 * 点正文 -> 光标落点的接线(用户 2026-10-03):
 *   `.md-body` 的直接子元素 = 顶层块(与 markdown-it 顶层 token 一一对应);
 *   点内层元素要**上溯到顶层块**再量可见偏移,否则块号与偏移会错位。
 * 几何量不出东西的 jsdom 里把「可见偏移」桩成固定值,专测接线与块号。
 */
import { describe, expect, it, vi } from 'vitest';
import { caretHintFromClick, topLevelBlock } from './body-caret';

const { visibleOffsetAtPoint } = vi.hoisted(() => ({ visibleOffsetAtPoint: vi.fn(() => 1) }));
vi.mock('./caret-at-point', () => ({ visibleOffsetAtPoint }));

const SOURCE = ['第一段正文', '', '## 标题二', '', '- 甲', '- 乙'].join('\n');

/** 与真实结构一致:外层是卡片容器(data-note-body),markdown 块在里面的 .md-body 里 */
function body(html: string): HTMLDivElement {
  const outer = document.createElement('div');
  outer.setAttribute('data-note-body', '5');
  const inner = document.createElement('div');
  inner.className = 'md-body';
  inner.innerHTML = html;
  outer.appendChild(inner);
  document.body.appendChild(outer);
  return outer;
}
const md = (outer: HTMLElement): HTMLElement => outer.querySelector('.md-body') as HTMLElement;

describe('topLevelBlock', () => {
  it('点内层元素时上溯到顶层块', () => {
    const b = body('<ul><li><strong>甲</strong></li></ul><p>尾巴</p>');
    const strong = b.querySelector('strong')!;
    expect(topLevelBlock(b, strong)).toBe(md(b).children[0]);
  });
  it('点正文之外返回 null', () => {
    const b = body('<p>x</p>');
    expect(topLevelBlock(b, document.createElement('span'))).toBeNull();
    expect(topLevelBlock(b, null)).toBeNull();
  });
});

describe('caretHintFromClick', () => {
  it('点第 1 段 -> 用第 0 块的源码换算(偏移随桩值为 1)', () => {
    const b = body('<p>第一段正文</p><h2>标题二</h2>');
    const off = caretHintFromClick(b, md(b).children[0], 10, 10, SOURCE);
    expect(off).toBe(1);
    expect(visibleOffsetAtPoint).toHaveBeenCalledWith(md(b).children[0], 10, 10);
  });

  it('点列表项(内层 li)-> 仍用第 2 块(列表)换算,块号不错位', () => {
    const b = body('<p>第一段正文</p><h2>标题二</h2><ul><li>甲</li><li>乙</li></ul>');
    const li = b.querySelectorAll('li')[1];
    const off = caretHintFromClick(b, li, 5, 5, SOURCE);
    // 第 2 块是列表,起点在 '- 甲' 行;偏移必须落在该块内而不是第 0 块
    const listStart = SOURCE.indexOf('- 甲');
    expect(off).toBeGreaterThanOrEqual(listStart);
  });

  it('量不出可见偏移 -> null(调用方退回末尾)', () => {
    visibleOffsetAtPoint.mockReturnValueOnce(null as unknown as number);
    const b = body('<p>第一段正文</p>');
    expect(caretHintFromClick(b, md(b).children[0], 1, 1, SOURCE)).toBeNull();
  });

  it('body 为空 / 目标不在正文里 -> null', () => {
    const b = body('<p>x</p>');
    expect(caretHintFromClick(null, b.children[0], 1, 1, SOURCE)).toBeNull();
    expect(caretHintFromClick(b, document.createElement('div'), 1, 1, SOURCE)).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sourceOffsetForVisible, visibleOffsetAtPoint } from './caret-at-point';

describe('sourceOffsetForVisible', () => {
  it('纯文本:一一对应(绝大多数格子)', () => {
    expect(sourceOffsetForVisible('第一', 0)).toBe(0);
    expect(sourceOffsetForVisible('第一', 1)).toBe(1);
    expect(sourceOffsetForVisible('第一', 2)).toBe(2);
  });
  it('跳过 markdown 标记:可见第 N 个字符之后的光标位置', () => {
    // `**粗**体`:可见文本是「粗体」
    expect(sourceOffsetForVisible('**粗**体', 0)).toBe(0); // 点在格子最左:光标落在源码最前
    expect(sourceOffsetForVisible('**粗**体', 1)).toBe(5); // 第一个可见字「粗」之后(跳过收尾的 **)
    expect(sourceOffsetForVisible('**粗**体', 2)).toBe(6); // 第二个可见字「体」之后
  });
  it('行内代码与链接记号同样跳过', () => {
    expect(sourceOffsetForVisible('`x`后', 1)).toBe(3);
    expect(sourceOffsetForVisible('`x`后', 2)).toBe(4);
    expect(sourceOffsetForVisible('[[甲]]乙', 1)).toBe(5);
    expect(sourceOffsetForVisible('[[甲]]乙', 2)).toBe(6);
  });
  it('越界收敛到两端', () => {
    expect(sourceOffsetForVisible('ab', -3)).toBe(0);
    expect(sourceOffsetForVisible('ab', 99)).toBe(2);
    expect(sourceOffsetForVisible('', 3)).toBe(0);
  });
});

describe('visibleOffsetAtPoint', () => {
  const cell = (html: string): HTMLElement => {
    const el = document.createElement('td');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  };

  it('jsdom 没有 caretRangeFromPoint:安全返回 null(退化成默认光标位置)', () => {
    const el = cell('第一');
    expect(visibleOffsetAtPoint(el, 0, 0)).toBeNull();
  });

  it('有 caretRangeFromPoint 时:把点击处的节点偏移累加成整格偏移', () => {
    const el = cell('<strong>粗</strong>体');
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);
    // 模拟点在第二个文本节点(「体」)的第 1 个字符之后
    (el.ownerDocument as unknown as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => {
      const r = document.createRange();
      r.setStart(textNodes[1], 1);
      r.collapse(true);
      return r;
    };
    expect(visibleOffsetAtPoint(el, 10, 10)).toBe(2);
  });
});

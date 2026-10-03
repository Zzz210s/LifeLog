// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { nearestBoundary, sourceOffsetForVisible, visibleOffsetAtPoint, type CharBox } from './caret-at-point';

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

/** 造一行等宽字符:每个 10px 宽,从 x0 起 */
const row = (count: number, x0 = 0, y = 100): CharBox[] =>
  Array.from({ length: count }, (_, i) => ({ left: x0 + i * 10, right: x0 + i * 10 + 10, centerY: y }));

describe('nearestBoundary(不依赖 caretRangeFromPoint)', () => {
  it('点在某个字左半区 -> 落在它前面', () => {
    expect(nearestBoundary(row(3), 12, 100)).toBe(1); // 第 2 个字符(10..20)左半区
  });
  it('点在某个字右半区 -> 落在它后面', () => {
    expect(nearestBoundary(row(3), 18, 100)).toBe(2);
  });
  it('点在文本左边留白 -> 0(最前)', () => {
    expect(nearestBoundary(row(3, 100), 20, 100)).toBe(0);
  });
  it('点在文本右边留白 -> 末尾(短文本格子的常见情况:留白占大半)', () => {
    expect(nearestBoundary(row(3, 100), 300, 100)).toBe(3);
  });
  it('多行:先选同一行,再按水平距离', () => {
    const chars = [...row(3, 0, 100), ...row(3, 0, 120)];
    expect(nearestBoundary(chars, 12, 121)).toBe(4); // 第二行的第 2 个字符
  });
  it('空数组 -> 0', () => {
    expect(nearestBoundary([], 5, 5)).toBe(0);
  });
});

describe('visibleOffsetAtPoint', () => {
  const cell = (html: string): HTMLElement => {
    const el = document.createElement('td');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  };
  /** jsdom 不排版:把 Range.getBoundingClientRect 桩成"每个字符 10px 宽" */
  const stubRects = (el: HTMLElement, width = 10): void => {
    const proto = el.ownerDocument.createRange().constructor.prototype as {
      getBoundingClientRect?: () => DOMRect;
    };
    proto.getBoundingClientRect = function (this: Range): DOMRect {
      const start = this.startOffset;
      const left = start * width;
      return { left, right: left + width, top: 100, bottom: 120, width, height: 20,
        x: left, y: 100, toJSON: () => ({}) } as unknown as DOMRect;
    };
  };

  it('空单元格:量不出字符 -> null(调用方退回默认光标)', () => {
    const el = cell('');
    expect(visibleOffsetAtPoint(el, 10, 10)).toBeNull();
  });

  it('有字符:按最近的字符边界给出偏移', () => {
    const el = cell('第一第二');
    stubRects(el);
    expect(visibleOffsetAtPoint(el, 5, 110)).toBe(0); // 第 1 个字符左半区
    expect(visibleOffsetAtPoint(el, 15, 110)).toBe(1); // 第 1 个字符右半区 -> 落在它之后
    expect(visibleOffsetAtPoint(el, 999, 110)).toBe(4); // 远在右侧 -> 末尾
  });

  it('带内联标签的格子:文本节点按顺序累加', () => {
    const el = cell('第一<strong>粗</strong>体');
    stubRects(el);
    // 第 3 个可见字符「粗」在 20..30
    expect(visibleOffsetAtPoint(el, 21, 110)).toBe(2);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hoverTitle, titleIfTruncated } from './truncate-title';

/** 造一个只有宽度读数的假元素:scrolled 决定是否"被截断" */
function fakeEl(scrolled: boolean): HTMLElement {
  const el = document.createElement('button');
  Object.defineProperty(el, 'scrollWidth', { value: scrolled ? 400 : 100, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
  return el;
}

describe('悬浮提示只在被截断时出现', () => {
  it('未截断:不挂 title(可见文字已经完整,提示是噪声)', () => {
    const el = fakeEl(false);
    titleIfTruncated(el, '时间/日期/2026/09/28');
    expect(el.getAttribute('title')).toBeNull();
  });

  it('被截断:挂上完整文本', () => {
    const el = fakeEl(true);
    titleIfTruncated(el, '地点/所在/中国大陆/四川省/成都市/武侯区');
    expect(el.getAttribute('title')).toBe('地点/所在/中国大陆/四川省/成都市/武侯区');
  });

  it('从截断变回未截断(窗口变宽):清掉旧 title,不残留', () => {
    const el = fakeEl(true);
    titleIfTruncated(el, 'x');
    expect(el.getAttribute('title')).toBe('x');
    Object.defineProperty(el, 'scrollWidth', { value: 100, configurable: true });
    titleIfTruncated(el, 'x');
    expect(el.getAttribute('title')).toBeNull();
  });

  it('hoverTitle 形态:读 currentTarget 并同样只在截断时挂', () => {
    const long = fakeEl(true);
    hoverTitle('a/b')({ currentTarget: long });
    expect(long.getAttribute('title')).toBe('a/b');
    const short = fakeEl(false);
    hoverTitle('a/b')({ currentTarget: short });
    expect(short.getAttribute('title')).toBeNull();
  });

  it('元素为空时不抛(卸载中的兜底)', () => {
    expect(() => titleIfTruncated(null, 'x')).not.toThrow();
    expect(() => titleIfTruncated(undefined, 'x')).not.toThrow();
  });
});

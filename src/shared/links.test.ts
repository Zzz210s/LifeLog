// @vitest-environment jsdom
// jsdom:linkHrefFrom 依赖真实 DOM 的 closest/Element
import { describe, expect, it } from 'vitest';
import { linkHrefFrom } from './links';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('linkHrefFrom', () => {
  it('点击 a 本身返回 href', () => {
    const el = mount('<a href="https://example.com">外链</a>').querySelector('a');
    expect(linkHrefFrom(el)).toBe('https://example.com');
  });

  it('点击 a 内部子元素也能上溯到链接', () => {
    const el = mount('<a href="https://example.com"><span id="s">外链</span></a>');
    expect(linkHrefFrom(el.querySelector('#s'))).toBe('https://example.com');
  });

  it('非链接元素返回 null', () => {
    const el = mount('<p id="p">普通文本</p>');
    expect(linkHrefFrom(el.querySelector('#p'))).toBeNull();
  });

  it('无 href 的 a 不算可导航链接', () => {
    const el = mount('<a id="a">锚点</a>');
    expect(linkHrefFrom(el.querySelector('#a'))).toBeNull();
  });

  it('null / 非 Element 目标安全返回 null', () => {
    expect(linkHrefFrom(null)).toBeNull();
    expect(linkHrefFrom({} as EventTarget)).toBeNull();
  });
});

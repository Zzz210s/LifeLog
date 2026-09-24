// @vitest-environment jsdom
/** 滚到笔记的用例(Task 6 Step 4):不存在不抛、视野外才滚。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollIntoViewIfNeeded, visibleOrScroll } from './scroll-to-note';

afterEach(() => {
  document.body.innerHTML = '';
});

/** 造一条带 data-note-body 的行(NoteItem 的既有属性) */
const row = (id: number): HTMLElement => {
  const el = document.createElement('div');
  el.setAttribute('data-note-body', String(id));
  document.body.append(el);
  return el;
};

describe('滚到笔记(采纳 `@` 的落地)', () => {
  it('元素不存在:返回 false 且不抛(采纳路径不能被打断)', () => {
    expect(visibleOrScroll(null)).toBe(false);
    expect(() => scrollIntoViewIfNeeded(999)).not.toThrow();
    expect(scrollIntoViewIfNeeded(999)).toBe(false);
  });

  it('元素存在:返回 true;jsdom 无布局按"已可见"处理,不调用滚动', () => {
    const el = row(7);
    const spy = vi.fn();
    el.scrollIntoView = spy;
    expect(scrollIntoViewIfNeeded(7)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('元素在视野外(下方):滚到中间', () => {
    const el = row(7);
    el.getBoundingClientRect = () => ({ top: 900, bottom: 960 }) as DOMRect;
    const spy = vi.fn();
    el.scrollIntoView = spy;
    expect(visibleOrScroll(el)).toBe(true);
    expect(spy).toHaveBeenCalledWith({ block: 'center' });
  });

  it('元素在视野上方(滚过头):同样滚回中间', () => {
    const el = row(7);
    el.getBoundingClientRect = () => ({ top: -400, bottom: -340 }) as DOMRect;
    const spy = vi.fn();
    el.scrollIntoView = spy;
    expect(visibleOrScroll(el)).toBe(true);
    expect(spy).toHaveBeenCalledWith({ block: 'center' });
  });
});

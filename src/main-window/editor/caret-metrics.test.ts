// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { caretScrollFromTop, measureCaretTop } from './caret-metrics';

describe('caretScrollFromTop(按真实光标位置算滚动)', () => {
  it('光标在中段:目标 = 光标位置 − 1/3 视高', () => {
    expect(caretScrollFromTop(1000, 600, 4000)).toBe(800);
  });
  it('光标靠近顶部:夹到 0', () => {
    expect(caretScrollFromTop(100, 600, 4000)).toBe(0);
  });
  it('光标靠近末尾:夹到最大滚动', () => {
    expect(caretScrollFromTop(3900, 600, 4000)).toBe(3400);
  });
  it('拿不到位置(NaN):返回 0,不抛', () => {
    expect(caretScrollFromTop(Number.NaN, 600, 4000)).toBe(0);
  });
});

describe('measureCaretTop(镜像测量)', () => {
  it('没有父元素时返回 null(调用方退回估算)', () => {
    const ta = document.createElement('textarea');
    ta.value = 'abc';
    expect(measureCaretTop(ta, 1)).toBeNull();
  });

  it('挂在文档里:返回一个有限数值,且不残留镜像节点', () => {
    const wrap = document.createElement('div');
    const ta = document.createElement('textarea');
    ta.value = '第一行\n第二行\n第三行';
    wrap.appendChild(ta);
    document.body.appendChild(wrap);
    const before = document.body.querySelectorAll('div').length;
    const top = measureCaretTop(ta, ta.value.length);
    expect(top).not.toBeNull();
    expect(Number.isFinite(top as number)).toBe(true);
    // 镜像用完即删
    expect(document.body.querySelectorAll('div').length).toBe(before);
  });
});

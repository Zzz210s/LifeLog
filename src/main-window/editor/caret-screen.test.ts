import { describe, expect, it } from 'vitest';
import { caretScrollDelta } from './caret-screen';

describe('caretScrollDelta(把光标拉回点击的屏幕位置)', () => {
  it('光标落在点击位置下方:往下滚(正数)', () => {
    // 框顶在视口 100,光标在框内 400,框滚动 0 -> 光标屏幕 y = 500;点击在 300 -> 要往下滚 200
    expect(caretScrollDelta({ boxTop: 100, caretInBox: 400, boxScroll: 0, clickY: 300 })).toBe(200);
  });
  it('光标落在点击位置上方:往上滚(负数)', () => {
    expect(caretScrollDelta({ boxTop: 100, caretInBox: 100, boxScroll: 0, clickY: 300 })).toBe(-100);
  });
  it('已经对齐:0', () => {
    expect(caretScrollDelta({ boxTop: 50, caretInBox: 250, boxScroll: 0, clickY: 300 })).toBe(0);
  });
  it('框自身滚动会抵扣', () => {
    expect(caretScrollDelta({ boxTop: 0, caretInBox: 500, boxScroll: 300, clickY: 100 })).toBe(100);
  });
  it('拿不到数值:0(不动作)', () => {
    expect(caretScrollDelta({ boxTop: Number.NaN, caretInBox: 1, boxScroll: 0, clickY: 1 })).toBe(0);
  });
});

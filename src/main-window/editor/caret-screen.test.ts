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

describe('一步修正的收敛性(按当前滚动)', () => {
  it('重复应用不再来回跳:第二次的差值为 0', () => {
    // 框在内容里的位置固定为 800(视口位置 = 800 − scroll),光标在框内 200,点击在 300
    const boxInContent = 800;
    const caretInBox = 200;
    const clickY = 300;
    const step = (scroll: number) => {
      const boxTop = boxInContent - scroll;
      return scroll + caretScrollDelta({ boxTop, caretInBox, boxScroll: 0, clickY });
    };
    const s1 = step(562);
    const s2 = step(s1);
    expect(s1).toBe(562 + (800 - 562 + 200 - 300)); // 一步到位
    expect(s2).toBe(s1);                            // 再算一次不动 -> 收敛
  });
});

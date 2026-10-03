import { describe, expect, it } from 'vitest';
import { caretScrollTop } from './caret-scroll';

const base = { lineHeight: 24, clientHeight: 600, scrollHeight: 4000 };

describe('caretScrollTop(把光标行滚到框内 1/3 处)', () => {
  it('光标在中段:目标 = 行位置 − 1/3 视高', () => {
    // 第 40 行 -> y = 960;960 − 200 = 760
    expect(caretScrollTop({ ...base, caret: 500, newlinesBefore: 40 })).toBe(760);
  });

  it('光标在开头:夹到 0(不出现负滚动)', () => {
    expect(caretScrollTop({ ...base, caret: 0, newlinesBefore: 0 })).toBe(0);
  });

  it('光标在末尾:不超过 scrollHeight − clientHeight', () => {
    const v = caretScrollTop({ ...base, caret: 5000, newlinesBefore: 200 });
    expect(v).toBe(4000 - 600);
  });

  it('长行折行(字符数远多于换行数):按换行数估算,不夸张地多滚', () => {
    // 换行 5 行、光标前 800 字符(同一行的折行)-> 按 5 行估算:120 − 200 < 0 -> 夹到 0
    expect(caretScrollTop({ ...base, caret: 800, newlinesBefore: 5 })).toBe(0);
    // 换行 20 行时:480 − 200 = 280
    expect(caretScrollTop({ ...base, caret: 800, newlinesBefore: 20 })).toBe(280);
  });

  it('行高拿不到(0/NaN):返回 0,不抛', () => {
    expect(caretScrollTop({ ...base, lineHeight: 0, caret: 10, newlinesBefore: 2 })).toBe(0);
    expect(caretScrollTop({ ...base, lineHeight: Number.NaN, caret: 10, newlinesBefore: 2 })).toBe(0);
  });
});

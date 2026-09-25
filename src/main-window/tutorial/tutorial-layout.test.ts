import { describe, expect, it } from 'vitest';
import { holeRect, placeBubble } from './tutorial-layout';

describe('tutorial-layout', () => {
  it('洞口 = 目标外扩 4px', () => {
    expect(holeRect({ top: 10, left: 20, width: 100, height: 30 })).toEqual({ top: 6, left: 16, width: 108, height: 38 });
  });

  it('默认贴洞口下方居中', () => {
    const hole = { top: 100, left: 200, width: 300, height: 40 };
    const r = placeBubble(hole, { width: 320, height: 120 }, { width: 1100, height: 720 });
    expect(r.top).toBe(148);            // 140 + gap 8
    expect(r.left).toBe(190);           // 200 + (300-320)/2
  });

  it('下方空间不足 -> 贴上方', () => {
    const hole = { top: 600, left: 200, width: 300, height: 40 };
    const r = placeBubble(hole, { width: 320, height: 120 }, { width: 1100, height: 720 });
    expect(r.top).toBe(472);            // 600 - 8 - 120
  });

  it('左右越界 -> 钳在视口内 8px', () => {
    const right = placeBubble({ top: 10, left: 1050, width: 40, height: 20 }, { width: 320, height: 120 }, { width: 1100, height: 720 });
    expect(right.left).toBe(772);       // 1100 - 8 - 320
    const left = placeBubble({ top: 10, left: 0, width: 40, height: 20 }, { width: 320, height: 120 }, { width: 1100, height: 720 });
    expect(left.left).toBe(8);
  });
});

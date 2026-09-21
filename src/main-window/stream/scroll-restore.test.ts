import { describe, expect, it } from 'vitest';
import { applyScrollRestore } from './scroll-restore';

describe('applyScrollRestore(进编辑时把流滚动位置还原)', () => {
  it('已偏离记录值时写回并返回 true', () => {
    const el = { scrollTop: 258 };
    expect(applyScrollRestore(el, 200)).toBe(true);
    expect(el.scrollTop).toBe(200);
  });

  it('已经等于记录值时不写、返回 false(不反复钉住浏览器的锚定结果)', () => {
    const el = { scrollTop: 200 };
    expect(applyScrollRestore(el, 200)).toBe(false);
    expect(el.scrollTop).toBe(200);
  });

  it('没有记录值(或容器不存在)时不动作', () => {
    expect(applyScrollRestore({ scrollTop: 100 }, null)).toBe(false);
    expect(applyScrollRestore(null, 100)).toBe(false);
  });

  it('记录值非法(NaN/Infinity)时不动作', () => {
    const el = { scrollTop: 50 };
    expect(applyScrollRestore(el, Number.NaN)).toBe(false);
    expect(applyScrollRestore(el, Number.POSITIVE_INFINITY)).toBe(false);
    expect(el.scrollTop).toBe(50);
  });

  it('0 是合法位置(顶部)', () => {
    const el = { scrollTop: 120 };
    expect(applyScrollRestore(el, 0)).toBe(true);
    expect(el.scrollTop).toBe(0);
  });
});

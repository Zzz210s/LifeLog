import { describe, expect, it } from 'vitest';
import { applyScrollRestore, restoreScrollSoon, takeScrollRestore } from './scroll-restore';

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

describe('takeScrollRestore(一次性令牌:还原后置 null)', () => {
  it('写回旧位置并把 ref 清空,第二次调用不再动作', () => {
    const el = { scrollTop: 258 };
    const ref = { current: 200 as number | null };
    expect(takeScrollRestore(el, ref)).toBe(true);
    expect(el.scrollTop).toBe(200);
    expect(ref.current).toBe(null);
    // 模拟 EditPanel 在没有新 onEdit 的情况下重挂载:位置不会被拉回旧值(复审 A4)
    el.scrollTop = 700;
    expect(takeScrollRestore(el, ref)).toBe(false);
    expect(el.scrollTop).toBe(700);
  });

  it('位置已相等时也清空(call 过就算用掉)', () => {
    const el = { scrollTop: 200 };
    const ref = { current: 200 as number | null };
    expect(takeScrollRestore(el, ref)).toBe(false);
    expect(ref.current).toBe(null);
  });

  it('从未记录(初始 null)时不动作,也不报错', () => {
    const el = { scrollTop: 300 };
    const ref = { current: null as number | null };
    expect(takeScrollRestore(el, ref)).toBe(false);
    expect(el.scrollTop).toBe(300);
  });
});

describe('restoreScrollSoon(进编辑后多打几次)', () => {
  it('立即 + 下一帧 + 120ms 各还原一次', () => {
    const el = { scrollTop: 500 };
    const plan: Array<{ delay: number; fn: () => void }> = [];
    restoreScrollSoon(el, 200, (fn, delay) => plan.push({ delay, fn }));
    expect(el.scrollTop).toBe(200); // 立即
    expect(plan.map((p) => p.delay)).toEqual([0, 120, 400, 800]);
    el.scrollTop = 0; // 模拟浏览器随后把流滚回顶部
    plan[0].fn();
    expect(el.scrollTop).toBe(200);
    el.scrollTop = 0;
    plan[1].fn();
    expect(el.scrollTop).toBe(200);
    el.scrollTop = 0;
    plan[3].fn();
    expect(el.scrollTop).toBe(200);
  });

  it('没有记录值时:不动作', () => {
    const el = { scrollTop: 7 };
    const plan: Array<() => void> = [];
    restoreScrollSoon(el, null, (fn) => plan.push(fn));
    plan.forEach((f) => f());
    expect(el.scrollTop).toBe(7);
  });
});

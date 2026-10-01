/**
 * 一帧步进(`runFrame`)的预算与出口:每帧只跑到 budgetMs、时钟不前进时有步数上限兜底、
 * 已经静止的输入第一步就收敛。力的方向与锚点在 force-layout.test.ts。
 */
import { describe, expect, it } from 'vitest';
import { ALPHA_DECAY } from './force-layout';
import { FRAME_BUDGET_MS, MAX_STEPS_PER_FRAME, MAX_TOTAL_MS, runFrame } from './force-frame';
import type { Point } from './radial';

/** 三点夹具:1 在原点、2 与 3 各距 1(斥力会把它们推开) */
const P: Map<number, Point> = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 1, y: 0 }],
  [3, { x: 0, y: 1 }],
]);

const frame = (o: { now: () => number; alpha?: number; budgetMs?: number; points?: Map<number, Point> }) =>
  runFrame({
    points: o.points ?? P,
    edges: [],
    anchors: new Set(),
    alpha: o.alpha ?? 1,
    budgetMs: o.budgetMs ?? FRAME_BUDGET_MS,
    now: o.now,
  });

describe('runFrame:每帧预算与出口', () => {
  it('时钟 +5ms / 预算 8ms:第 2 步后就越界,本帧只走 2 步', () => {
    let clock = 0;
    const r = frame({ now: () => (clock += 5), budgetMs: 8 });
    expect(r.steps).toBe(2);
    expect(r.converged).toBe(false);
  });

  it('时钟不前进(异常)时靠步数上限兜底,不死循环', () => {
    // alpha 天文数字 = 每步位移都顶在 MAX_STEP(24):120 步内绝无收敛可能,只有上限能收场
    const r = frame({ now: () => 0, alpha: 1e9, budgetMs: 8 });
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(r.converged).toBe(false);
  });

  it('已经静止的输入在第一步就收敛(不空转)', () => {
    const r = frame({ now: () => 0, points: new Map([[1, { x: 0, y: 0 }]]) });
    expect(r.converged).toBe(true);
    expect(r.steps).toBe(1);
  });

  it('阻尼跨帧传递:同一个 alpha 进去、衰减后的 alpha 出来', () => {
    const r = frame({ now: () => 0, alpha: 1, points: new Map([[1, { x: 0, y: 0 }]]) });
    expect(r.alpha).toBeCloseTo(ALPHA_DECAY, 10);
  });

  it('口径:预算 8ms、总时长上限 1.5s', () => {
    expect(FRAME_BUDGET_MS).toBe(8);
    expect(MAX_TOTAL_MS).toBe(1500);
  });
});

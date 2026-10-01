/**
 * 力导向的**一帧**(纯函数,与 rAF / 时钟实现无关):
 * 反复 `forceStep` 直到超出时间预算、收敛、或撞上步数上限,返回本帧的位置与阻尼。
 *
 * 为什么单独一帧:`useForceLayout` 的 rAF 循环数不出"这一帧走了几步",而设计 §3.4 的
 * "每帧 ≤8ms"只有把预算判定放在可注入时钟的纯函数里才断言得了(见 force-frame.test.ts)。
 * `MAX_STEPS_PER_FRAME` 是给时钟不前进(jsdom / 异常)时的硬出口 —— 没有它这个 while 会死循环。
 */
import type { GraphEdge } from '../../shared/types';
import { ALPHA_DECAY, DEFAULT_GRID, forceStep, isConverged } from './force-layout';
import type { Point } from './radial';

/** 每帧时间预算(ms):超过就交还主线程(设计 §3.4 的"每帧 ≤8ms") */
export const FRAME_BUDGET_MS = 8;
/** 一次整理的最长时长(ms):不收敛也必须停(兜底;正常都在收敛判据上停) */
export const MAX_TOTAL_MS = 1500;
/** 收敛判据:两步之间的最大位移(世界坐标)小于它就认为摊开了 */
export const CONVERGE_EPS = 0.5;
/** 单帧步数上限:时钟不前进时的硬出口 */
export const MAX_STEPS_PER_FRAME = 120;

export interface FrameInput {
  points: Map<number, Point>;
  edges: readonly GraphEdge[];
  anchors: ReadonlySet<number>;
  /** 本帧起始的阻尼(跨帧传递) */
  alpha: number;
  /** 时钟(注入以便单测:预算判定全靠它) */
  now: () => number;
  budgetMs: number;
  grid?: number;
}

export interface FrameResult {
  points: Map<number, Point>;
  /** 传给下一帧的阻尼 */
  alpha: number;
  converged: boolean;
  /** 本帧实际走的步数(预算 / 收敛 / 上限三者取其先) */
  steps: number;
}

export function runFrame(input: FrameInput): FrameResult {
  const grid = input.grid ?? DEFAULT_GRID;
  const start = input.now();
  let points = input.points;
  let alpha = input.alpha;
  let converged = false;
  let steps = 0;
  while (steps < MAX_STEPS_PER_FRAME) {
    const next = forceStep({ points, edges: input.edges, anchors: input.anchors, alpha, grid });
    converged = isConverged(points, next, CONVERGE_EPS);
    points = next;
    alpha *= ALPHA_DECAY;
    steps += 1;
    if (converged || input.now() - start > input.budgetMs) break;
  }
  return { points, alpha, converged, steps };
}

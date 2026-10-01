/**
 * LOD 枢纽文字的**口径**用例(2026-10-01):阈值吃 `selfCount`(本级)而不是 `notes`(含子级)。
 *
 * 背景:展开时间轴后,`时间/日期/2026/03/28` 这类末级节点靠祖先的计数(1038)会抢到文字,
 * 图上会出现一堆"28""29"这样的段名。改用本级计数后,只有真正装了很多东西的标签才出文字。
 */
import { describe, expect, it } from 'vitest';
import { drawPlan } from './graph-draw-plan';
import { NO_EMPHASIS } from './graph-focus';
import type { GraphNode } from '../../shared/types';

const base = {
  edges: [],
  cam: { k: 1, tx: 0, ty: 0 },
  w: 400,
  h: 300,
  rootColor: new Map<number, string>(),
  fallbackColor: '#888888',
  emphasis: NO_EMPHASIS,
};

const n = (id: number, path: string, depth: number, parent: number | null, notes: number, selfCount: number): GraphNode => ({
  id, path, depth, parent, notes, selfCount, sortOrder: 0,
});

describe('枢纽文字按本级计数', () => {
  it('末级日期节点(含子级很大、本级为 0)不再抢文字', () => {
    const nodes = [
      n(1, '时间', 1, null, 1038, 0),
      n(2, '时间/日期/2026/03/28', 5, 1, 3, 0),
    ];
    const points = new Map([[1, { x: 0, y: 0 }], [2, { x: 100, y: 0 }]]);
    const plan = drawPlan({ ...base, nodes, points });
    expect(plan.labels).toEqual([]);
  });

  it('本级计数够大的标签仍然出文字(默认视图的枢纽不受影响)', () => {
    const nodes = [
      n(1, '状态', 1, null, 1053, 178),
      n(2, '状态/已完成', 2, 1, 178, 178),
    ];
    const points = new Map([[1, { x: 0, y: 0 }], [2, { x: 100, y: 0 }]]);
    const plan = drawPlan({ ...base, nodes, points });
    expect(plan.labels.map((l) => l.text).sort()).toEqual(['已完成', '状态']);
  });
});

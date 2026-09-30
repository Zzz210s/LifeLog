// @vitest-environment jsdom
/**
 * 展开笔记的取数与几何(G2 Task 6):
 * - 不展开(`node = null`)就不发请求,小圆为空
 * - 条件对象与信息流**同一份形状**,只有 `tags` 收窄到该路径(含子级),这样「图里展开的笔记」
 *   与「点筛到信息流后的结果」是同一批
 * - 小圆落点是**世界坐标**(相机换算交给 drawPlan),半径 = 标签半径 + 14,第一个圆在正上方
 * - 414 条 -> 只取第一页,画 20 个圆 + `+394`;取数失败不抛;库里取不到就不画幽灵圆
 * - 点中小圆 = 带着该标签回信息流(返回 true 让上层别再当画布点击)
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { queryNotes } = vi.hoisted(() => ({
  queryNotes: vi.fn(
    async (_conditions: FilterConditions, _offset: number): Promise<Note[]> => [],
  ),
}));
vi.mock('../../shared/api', () => ({ api: { queryNotes } }));

import type { FilterConditions } from '../../shared/filter-conditions';
import type { GraphNode, Note } from '../../shared/types';
import { radiusOf } from './graph-draw-plan';
import { screenOf, type Camera } from './graph-camera';
import { NOTE_LIMIT } from './graph-notes';
import type { Point } from './radial';
import { useExpandedNotes, type ExpandedNotesApi } from './use-expanded-notes';

/** 小圆离标签圆心的间距(与被测实现同一个数:改了口径这里就红) */
const GAP = 14;

/** 414 条(含子孙)的标签;`selfCount` 是本级,展开画的是含子孙那一批 */
const NODE: GraphNode = {
  id: 7,
  path: '工作/项目A',
  depth: 2,
  parent: 1,
  notes: 414,
  selfCount: 12,
  sortOrder: 3,
};
/** 标签落点:世界坐标 (100, 50);相机故意不是恒等变换(k=2 / tx=30 / ty=-10),
 * 这样「返回的是世界坐标」与「自己先换算成屏幕坐标」两种实现才能被区分;容器原点 (10, 20) */
const POINTS = new Map<number, Point>([[7, { x: 100, y: 50 }]]);
const CAM: Camera = { k: 2, tx: 30, ty: -10 };
const ORIGIN = { x: 10, y: 20 };

/** 第一页的读数:后端页大小 50,足以覆盖 20 个圆 */
const page = (n: number): Note[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    content: `笔记${i + 1}`,
    created_at: '2026-09-29 10:00:00',
    tags: ['工作/项目A'],
  }));

let api: ExpandedNotesApi | null = null;
let filtered: string[] = [];
let root: Root;
let host: HTMLDivElement;

function Harness(p: { node: GraphNode | null }): null {
  api = useExpandedNotes({
    node: p.node,
    points: POINTS,
    cam: CAM,
    origin: () => ORIGIN,
    onFilterToStream: (path) => filtered.push(path),
  });
  return null;
}

/** 挂载并 flush 取数回包(拒包也算回包) */
const mount = async (node: GraphNode | null): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness, { node }));
  });
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  queryNotes.mockReset();
  queryNotes.mockResolvedValue([]);
  api = null;
  filtered = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useExpandedNotes:取数口径', () => {
  it('不展开就不发请求,小圆为空', async () => {
    await mount(null);
    expect(queryNotes).not.toHaveBeenCalled();
    expect(api?.dots).toEqual([]);
    expect(api?.overflow).toBeNull();
    expect(api?.loading).toBe(false);
    expect(api?.failed).toBe(false);
  });

  it('414 条:只取第一页,条件与信息流同形状,画 20 个圆 + +394', async () => {
    queryNotes.mockResolvedValue(page(50));
    await mount(NODE);
    expect(queryNotes).toHaveBeenCalledTimes(1);
    const [conditions, offset] = queryNotes.mock.calls[0];
    expect(offset).toBe(0);
    // 字段逐个钉住:条件形状漂了,「图里展开的」就不再等于「筛到信息流后的」
    expect(conditions).toEqual({
      keyword: null,
      tags: [{ path: '工作/项目A', includeChildren: true }],
      excludeTags: [],
      tagPresence: null,
      sort: 'newest',
      expr: null,
    });
    expect(api?.dots).toHaveLength(NOTE_LIMIT);
    expect(api?.overflow).toEqual({ x: 100, y: 50, n: 414 - NOTE_LIMIT });
    expect(api?.loading).toBe(false);
    expect(api?.failed).toBe(false);
  });

  it('小圆落点是世界坐标:第一个圆在标签正上方 radiusOf(414) + 14 处', async () => {
    queryNotes.mockResolvedValue(page(50));
    await mount(NODE);
    const first = api?.dots[0];
    expect(first?.x).toBeCloseTo(100, 6);
    expect(first?.y).toBeCloseTo(50 - (radiusOf(414) + GAP), 6);
  });

  it('同一标签重渲染只请求一次(换了展开对象才重取)', async () => {
    queryNotes.mockResolvedValue(page(50));
    await mount(NODE);
    await mount(NODE);
    expect(queryNotes).toHaveBeenCalledTimes(1);
  });

  it('取数失败:failed = true,小圆为空,不抛', async () => {
    queryNotes.mockRejectedValue(new Error('查询炸了'));
    await mount(NODE);
    expect(api?.failed).toBe(true);
    expect(api?.loading).toBe(false);
    expect(api?.dots).toEqual([]);
    expect(api?.overflow).toBeNull();
  });

  it('库里一条都取不到(图数据与库不同步)就不画幽灵圆', async () => {
    queryNotes.mockResolvedValue([]);
    await mount(NODE);
    expect(api?.failed).toBe(false);
    expect(api?.dots).toEqual([]);
    expect(api?.overflow).toBeNull();
  });
});

describe('useExpandedNotes:点笔记小圆', () => {
  it('点中小圆 = 带着该标签回信息流;没点中就不动', async () => {
    queryNotes.mockResolvedValue(page(50));
    await mount(NODE);
    // 第一个圆的世界坐标 -> 屏幕坐标 -> client 坐标(命中侧要自己把 cam 算进去)
    const first = screenOf({ x: 100, y: 50 - (radiusOf(414) + GAP) }, CAM);
    const at = { clientX: ORIGIN.x + first.x, clientY: ORIGIN.y + first.y };
    expect(api?.onNoteClick(at)).toBe(true);
    expect(filtered).toEqual(['工作/项目A']);
    expect(api?.onNoteClick({ clientX: 500, clientY: 500 })).toBe(false);
    expect(filtered).toEqual(['工作/项目A']); // 没命中就不触发
  });

  it('没展开 / 取不到笔记时不吞点击', async () => {
    queryNotes.mockResolvedValue([]);
    await mount(NODE);
    expect(api?.onNoteClick({ clientX: ORIGIN.x + 100, clientY: ORIGIN.y + 50 })).toBe(false);
    await mount(null);
    expect(api?.onNoteClick({ clientX: ORIGIN.x + 100, clientY: ORIGIN.y + 50 })).toBe(false);
  });
});

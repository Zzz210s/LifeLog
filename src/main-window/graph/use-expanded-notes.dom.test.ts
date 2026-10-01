// @vitest-environment jsdom
/**
 * 展开笔记的取数与几何(G2 Task 6):
 * - 不展开(`node = null`)就不发请求,小圆为空
 * - 条件对象与信息流**同一份形状**,只有 `tags` 收窄到该路径(含子级),这样「图里展开的笔记」
 *   与「点筛到信息流后的结果」是同一批
 * - 小圆落点是**屏幕坐标**(先把标签落点过一次 screenOf),半径 = 标签半径 + 14 的屏幕像素,
 *   第一个圆在正上方 —— 不随相机缩放(G3 把这条定死)
 * - 414 条 -> 只取第一页,画 20 个圆 + `+394`(带所属标签 id);取数失败不抛;库里取不到就不画幽灵圆
 * - 展开层身份稳定:相同输入重渲染拿到**同一个对象**(plan 的 memo 靠它,否则每次渲染都白重建)
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
import { type Camera } from './graph-camera';
import { NOTE_LIMIT, OVERFLOW_GAP } from './graph-notes';
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
/** 标签落点:世界坐标 (100, 50),屏幕位置就是 (230, 90);相机故意不是恒等变换(k=2 / tx=30 / ty=-10),
 * 这样屏幕口径下小圆会落在 (230, 90) 周围,而不是仍停在世界坐标 (100, 50) 上(两种实现能区分);容器原点 (10, 20) */
const POINTS = new Map<number, Point>([[7, { x: 100, y: 50 }]]);
const CAM: Camera = { k: 2, tx: 30, ty: -10 };
const ORIGIN = { x: 10, y: 20 };

/** 第一页的读数:后端页大小 50,足以覆盖 20 个圆 */
const page = (n: number): Note[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    content: `笔记${i + 1}`,
    created_at: '2026-09-29 10:00:00', links: [],
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
  it('不展开就不发请求,展开层是 null(没有小圆也没有 +N)', async () => {
    await mount(null);
    expect(queryNotes).not.toHaveBeenCalled();
    expect(api?.layer).toBeNull();
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
    expect(api?.layer?.dots).toHaveLength(NOTE_LIMIT);
    expect(api?.layer?.space).toBe('screen'); // 口径随数据一起递出去,上层不用猜
    // `+N` 画在环外偏下(标签屏幕位置 (230, 90) + 扇形半径 + 12),并带着所属标签 id(命中它要知道带哪个标签回信息流)
    expect(api?.layer?.overflow).toEqual({ id: 7, x: 230, y: 90 + radiusOf(414) + GAP + OVERFLOW_GAP, n: 414 - NOTE_LIMIT });
    expect(api?.loading).toBe(false);
    expect(api?.failed).toBe(false);
  });

  it('展开层身份稳定:同一份数据重渲染拿到同一个对象(plan 的 memo 靠这条)', async () => {
    queryNotes.mockResolvedValue(page(50));
    await mount(NODE);
    const first = api?.layer;
    expect(first).not.toBeNull();
    await mount(NODE);
    expect(api?.layer).toBe(first);
  });

  it('小圆落点是屏幕坐标:第一个圆在标签屏幕位置 (230, 90) 正上方 radiusOf(414) + 14 处', async () => {
    queryNotes.mockResolvedValue(page(50));
    await mount(NODE);
    const first = api?.layer?.dots[0];
    expect(first?.x).toBeCloseTo(230, 6);
    expect(first?.y).toBeCloseTo(90 - (radiusOf(414) + GAP), 6);
  });

  it('同一标签重渲染只请求一次(换了展开对象才重取)', async () => {
    queryNotes.mockResolvedValue(page(50));
    await mount(NODE);
    await mount(NODE);
    expect(queryNotes).toHaveBeenCalledTimes(1);
  });

  it('取数失败:failed = true,展开层为空,不抛', async () => {
    queryNotes.mockRejectedValue(new Error('查询炸了'));
    await mount(NODE);
    expect(api?.failed).toBe(true);
    expect(api?.loading).toBe(false);
    expect(api?.layer).toBeNull();
  });

  it('库里一条都取不到(图数据与库不同步)就不画幽灵圆', async () => {
    queryNotes.mockResolvedValue([]);
    await mount(NODE);
    expect(api?.failed).toBe(false);
    expect(api?.layer).toBeNull();
  });
});

describe('useExpandedNotes:点笔记小圆', () => {
  it('点中小圆 = 带着该标签回信息流;没点中就不动', async () => {
    queryNotes.mockResolvedValue(page(50));
    await mount(NODE);
    // 小圆已是屏幕坐标 -> client 坐标(命中侧只加容器原点,没过相机)
    const first = { x: 230, y: 90 - (radiusOf(414) + GAP) };
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

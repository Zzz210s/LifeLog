// @vitest-environment jsdom
/**
 * 展开笔记的取数与几何(G2 Task 6):
 * - 不展开(`node = null`)就不发请求,小圆为空
 * - 条件对象与信息流**同一份形状**,只有 `tags` 收窄到该路径(含子级),这样「图里展开的笔记」
 *   与「点筛到信息流后的结果」是同一批
 * - 小圆落点是**屏幕坐标**(先把标签落点过一次 screenOf),半径 = 标签半径 + 14 的屏幕像素,
 *   第一个圆在正上方 —— 不随相机缩放(G3 把这条定死)
 * - 414 条 -> 只取第一页,画 20 个圆 + `+394`(带所属标签 id);取数失败不抛;库里取不到就不画幽灵圆
 * - 展开层身份稳定:相同输入重渲染拿到**同一个对象**(plan 的 memo 靠它)
 * 点小圆回信息流的用例在 `use-expanded-notes-click.dom.test.ts`(拆分守 200 行)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import { radiusOf } from './graph-draw-plan';
import { NOTE_LIMIT, OVERFLOW_GAP } from './graph-notes';
import { GAP, mountExpandedNotes, NODE, page, type MountedExpanded } from './__fixtures__/expanded-notes-harness';

const { queryNotes } = vi.hoisted(() => ({
  queryNotes: vi.fn(
    async (_conditions: FilterConditions, _offset: number): Promise<Note[]> => [],
  ),
}));
vi.mock('../../shared/api', () => ({ api: { queryNotes } }));

let m: MountedExpanded;

beforeEach(() => {
  queryNotes.mockReset();
  queryNotes.mockResolvedValue([]);
  m = mountExpandedNotes();
});

afterEach(() => {
  m.unmount();
});

describe('useExpandedNotes:取数口径', () => {
  it('不展开就不发请求,展开层是 null(没有小圆也没有 +N)', async () => {
    await m.mount(null);
    expect(queryNotes).not.toHaveBeenCalled();
    expect(m.api()?.layer).toBeNull();
    expect(m.api()?.loading).toBe(false);
    expect(m.api()?.failed).toBe(false);
  });

  it('414 条:只取第一页,条件与信息流同形状,画 20 个圆 + +394', async () => {
    queryNotes.mockResolvedValue(page(50));
    await m.mount(NODE);
    expect(queryNotes).toHaveBeenCalledTimes(1);
    const [conditions, offset] = queryNotes.mock.calls[0];
    expect(offset).toBe(0);
    // 字段逐个钉住:条件形状漂了,「图里展开的」就不再等于「筛到信息流后的」
    expect(conditions).toEqual({
      keyword: null,
      tags: [{ path: '工作/项目A', includeChildren: true }],
      excludeTags: [],
      relations: [],
      excludeRelations: [],
      tagPresence: null,
      sort: 'newest',
      sorts: [],
      expr: null,
      groupOp: 'and',
      groups: [],
    });
    expect(m.api()?.layer?.dots).toHaveLength(NOTE_LIMIT);
    // 每个小圆带**笔记 id**(L4 的 link 边靠它在两个圆之间连线):第 i 个圆就是第一页第 i 条笔记
    expect(m.api()?.layer?.dots.map((d) => d.id)).toEqual(Array.from({ length: NOTE_LIMIT }, (_, i) => i + 1));
    expect(m.api()?.layer?.space).toBe('screen'); // 口径随数据一起递出去,上层不用猜
    // `+N` 画在环外偏下(标签屏幕位置 (230, 90) + 扇形半径 + 12),并带着所属标签 id
    expect(m.api()?.layer?.overflow).toEqual({ id: 7, x: 230, y: 90 + radiusOf(414) + GAP + OVERFLOW_GAP, n: 414 - NOTE_LIMIT });
    expect(m.api()?.loading).toBe(false);
    expect(m.api()?.failed).toBe(false);
  });

  it('展开层身份稳定:同一份数据重渲染拿到同一个对象(plan 的 memo 靠这条)', async () => {
    queryNotes.mockResolvedValue(page(50));
    await m.mount(NODE);
    const first = m.api()?.layer;
    expect(first).not.toBeNull();
    await m.mount(NODE);
    expect(m.api()?.layer).toBe(first);
  });

  it('小圆落点是屏幕坐标:第一个圆在标签屏幕位置 (230, 90) 正上方 radiusOf(414) + 14 处', async () => {
    queryNotes.mockResolvedValue(page(50));
    await m.mount(NODE);
    const first = m.api()?.layer?.dots[0];
    expect(first?.x).toBeCloseTo(230, 6);
    expect(first?.y).toBeCloseTo(90 - (radiusOf(414) + GAP), 6);
  });

  it('同一标签重渲染只请求一次(换了展开对象才重取)', async () => {
    queryNotes.mockResolvedValue(page(50));
    await m.mount(NODE);
    await m.mount(NODE);
    expect(queryNotes).toHaveBeenCalledTimes(1);
  });

  it('取数失败:failed = true,展开层为空,不抛', async () => {
    queryNotes.mockRejectedValue(new Error('查询炸了'));
    await m.mount(NODE);
    expect(m.api()?.failed).toBe(true);
    expect(m.api()?.loading).toBe(false);
    expect(m.api()?.layer).toBeNull();
  });

  it('库里一条都取不到(图数据与库不同步)就不画幽灵圆', async () => {
    queryNotes.mockResolvedValue([]);
    await m.mount(NODE);
    expect(m.api()?.failed).toBe(false);
    expect(m.api()?.layer).toBeNull();
  });
});

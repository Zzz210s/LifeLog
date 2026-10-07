// @vitest-environment jsdom
/**
 * 点展开层的小圆 = 带着该标签回信息流(自 use-expanded-notes.dom.test.ts 拆出守 200 行):
 * 命中就返回 true 让上层别再当画布点击;没展开 / 取不到笔记时不吞点击。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import { radiusOf } from './graph-draw-plan';
import { GAP, mountExpandedNotes, NODE, ORIGIN, page, type MountedExpanded } from './__fixtures__/expanded-notes-harness';

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

describe('useExpandedNotes:点笔记小圆', () => {
  it('点中小圆 = 带着该标签回信息流;没点中就不动', async () => {
    queryNotes.mockResolvedValue(page(50));
    await m.mount(NODE);
    // 小圆已是屏幕坐标 -> client 坐标(命中侧只加容器原点,没过相机)
    const first = { x: 230, y: 90 - (radiusOf(414) + GAP) };
    const at = { clientX: ORIGIN.x + first.x, clientY: ORIGIN.y + first.y };
    expect(m.api()?.onNoteClick(at)).toBe(true);
    expect(m.filtered()).toEqual(['工作/项目A']);
    expect(m.api()?.onNoteClick({ clientX: 500, clientY: 500 })).toBe(false);
    expect(m.filtered()).toEqual(['工作/项目A']); // 没命中就不触发
  });

  it('没展开 / 取不到笔记时不吞点击', async () => {
    queryNotes.mockResolvedValue([]);
    await m.mount(NODE);
    expect(m.api()?.onNoteClick({ clientX: ORIGIN.x + 100, clientY: ORIGIN.y + 50 })).toBe(false);
    await m.mount(null);
    expect(m.api()?.onNoteClick({ clientX: ORIGIN.x + 100, clientY: ORIGIN.y + 50 })).toBe(false);
  });
});

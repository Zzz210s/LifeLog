/**
 * 批量纯逻辑用例(spec 2026-10-17 §3/§5):选中集增删、两个全选按钮的态与文案、两段回执文案。
 * 文案与态在同一个函数里出 —— 这里的断言就是"按钮写着全选但点了是取消"这类漂移的钉子。
 */
import { describe, expect, it } from 'vitest';
import {
  BATCH_SELECT_WARN,
  addIds,
  addTagNotice,
  containsAll,
  removeIds,
  removeTagNotice,
  selectAllLabel,
  selectPageLabel,
  toggleId,
} from './batch-mode';

describe('选中集增删', () => {
  it('toggleId 是加 / 移出两态且不改原集合', () => {
    const base = new Set([1]);
    expect([...toggleId(base, 2)]).toEqual([1, 2]);
    expect([...toggleId(base, 1)]).toEqual([]);
    expect([...base]).toEqual([1]);
  });

  it('addIds / removeIds 幂等', () => {
    const s = addIds(new Set([1]), [1, 2, 2]);
    expect([...s].sort()).toEqual([1, 2]);
    expect([...removeIds(s, [2, 9])]).toEqual([1]);
  });
});

describe('全选态判定', () => {
  it('containsAll:空组恒 false(没有东西可"全选")', () => {
    expect(containsAll(new Set(), [])).toBe(false);
    expect(containsAll(new Set([1]), [1])).toBe(true);
    expect(containsAll(new Set([1]), [1, 2])).toBe(false);
  });

  it('两个按钮的文案随态变', () => {
    expect(selectPageLabel(false)).toBe('全选本页');
    expect(selectPageLabel(true)).toBe('取消本页');
    expect(selectAllLabel(false, 12)).toBe('全选筛选结果');
    expect(selectAllLabel(true, 12)).toBe('取消全选');
  });

  it(`超过 ${BATCH_SELECT_WARN} 条时全选按钮带上读数`, () => {
    expect(selectAllLabel(false, BATCH_SELECT_WARN + 1)).toContain(String(BATCH_SELECT_WARN + 1));
    expect(selectAllLabel(false, null)).toBe('全选筛选结果');
  });
});

describe('回执文案', () => {
  it('加标签:有已存在的条目才带括号段;一条没改时给"没有需要改动的"', () => {
    expect(addTagNotice(5, 0, '工作')).toBe('已给 5 条加 #工作');
    expect(addTagNotice(5, 2, '工作')).toBe('已给 5 条加 #工作（2 条已有）');
    expect(addTagNotice(0, 0, '工作')).toBe('没有需要改动的条目');
    expect(addTagNotice(0, 3, '工作')).toBe('已给 0 条加 #工作（3 条已有）');
  });

  it('去标签:名线被保留时必须交代', () => {
    expect(removeTagNotice(4, 0, '工作')).toBe('已从 4 条去掉 #工作');
    expect(removeTagNotice(4, 1, '工作')).toBe('已从 4 条去掉 #工作（1 条带同名关系，未动）');
    expect(removeTagNotice(0, 0, '工作')).toBe('没有需要改动的条目');
    expect(removeTagNotice(0, 1, '工作')).toBe('已从 0 条去掉 #工作（1 条带同名关系，未动）');
  });
});

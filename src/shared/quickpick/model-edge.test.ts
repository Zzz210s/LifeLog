/**
 * 列表模型的边界口径(M3 重复 id / M4 limit 校验 / M6 非有限分)。
 * 单独成文件:`model.test.ts` 加完这三组会超 200 行红线(全局规则)。
 */
import { describe, expect, it } from 'vitest';
import { QUICK_OPEN_LIMIT, buildList, type QuickPickItem } from './model';

const ITEMS: readonly QuickPickItem[] = [
  { id: 'a', label: '工作/项目A' },
  { id: 'b', label: '生活/买菜' },
  { id: 'c', label: '项目B 计划' },
  { id: 'd', label: '读书笔记' },
];

const ids = (rows: readonly { item: QuickPickItem }[]): string[] => rows.map((r) => r.item.id);
const many = (count: number): QuickPickItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: `i${i}`, label: `第 ${i} 条` }));

describe('重复 id 的口径(M3)', () => {
  it('MRU 重复 id:rank 与 mruCount 都取最大次数(不一处取首个、一处取最大)', () => {
    const { rows } = buildList({
      items: ITEMS,
      query: '',
      mru: [
        { id: 'b', count: 1 },
        { id: 'b', count: 3 },
        { id: 'c', count: 2 },
      ],
    });
    expect(ids(rows)).toEqual(['b', 'c', 'a', 'd']);
    expect(rows[0].mruCount).toBe(3);
    expect(rows[1].mruCount).toBe(2);
  });

  it('pinned 重复 id 取最后一次出现的位置(后者覆盖前者)', () => {
    const { rows } = buildList({ items: ITEMS, query: '', pinned: ['d', 'a', 'd'] });
    expect(ids(rows)).toEqual(['a', 'd', 'b', 'c']);
  });
});

describe('limit 校验(M4)', () => {
  it('小数向下取整:1.5 → 1 行', () => {
    const { rows, total, truncated } = buildList({ items: ITEMS, query: '', limit: 1.5 });
    expect(ids(rows)).toEqual(['a']);
    expect(total).toBe(4);
    expect(truncated).toBe(true);
  });

  it('非有限值回退缺省上限(NaN / Infinity 不给错读的 total)', () => {
    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = buildList({ items: many(250), query: '', limit });
      expect(result.rows).toHaveLength(QUICK_OPEN_LIMIT);
      expect(result.total).toBe(250);
      expect(result.truncated).toBe(true);
    }
  });

  it('负数给 0 行,与 limit <= 0 口径一致', () => {
    const { rows, total, truncated } = buildList({ items: ITEMS, query: '', limit: -3 });
    expect(rows).toEqual([]);
    expect(total).toBe(4);
    expect(truncated).toBe(true);
  });
});

describe('预计算 score 的非有限值(M6)', () => {
  it('Infinity / NaN 一律视为不命中,只有正有限分入选', () => {
    const weird: QuickPickItem[] = [
      { id: 'inf', label: '项A', score: Number.POSITIVE_INFINITY, positions: [0] },
      { id: 'nan', label: '项A', score: Number.NaN, positions: [0] },
      { id: 'ok', label: '项A 正常', score: 7, positions: [0] },
    ];
    const { rows, total } = buildList({ items: weird, query: '项A' });
    expect(ids(rows)).toEqual(['ok']);
    expect(total).toBe(1);
  });
});

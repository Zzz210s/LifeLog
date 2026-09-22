import { describe, expect, it } from 'vitest';
import { EMPTY_QUERY_SCORE, LABEL_PREFIX_BOOST, PATH_BOOST } from '../fuzzy-score';
import { COMPLETE_LIMIT, QUICK_OPEN_LIMIT, buildList, type QuickPickItem } from './model';

const ITEMS: readonly QuickPickItem[] = [
  { id: 'a', label: '工作/项目A' },
  { id: 'b', label: '生活/买菜' },
  { id: 'c', label: '项目B 计划' },
  { id: 'd', label: '读书笔记' },
];

const ids = (rows: readonly { item: QuickPickItem }[]): string[] => rows.map((r) => r.item.id);

describe('空查询:固定 → 最近 → 全量', () => {
  it('三档顺序固定,未见过的项按传入顺序垫底', () => {
    const { rows, total, truncated } = buildList({
      items: ITEMS,
      query: '',
      mru: [
        { id: 'b', count: 3 },
        { id: 'c', count: 1 },
      ],
      pinned: ['d'],
    });
    expect(ids(rows)).toEqual(['d', 'b', 'c', 'a']);
    expect(total).toBe(4);
    expect(truncated).toBe(false);
  });

  it('固定项之间按传入的 pinned 顺序(与 items 顺序无关)', () => {
    const { rows } = buildList({ items: ITEMS, query: '', pinned: ['d', 'a'] });
    expect(ids(rows)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('固定项同时进过 MRU 只出现一次,且按固定档位排', () => {
    const { rows } = buildList({
      items: ITEMS,
      query: '',
      mru: [
        { id: 'b', count: 9 },
        { id: 'c', count: 1 },
      ],
      pinned: ['b'],
    });
    expect(ids(rows)).toEqual(['b', 'c', 'a', 'd']);
    expect(rows).toHaveLength(4);
    expect(rows[0].pinned).toBe(true);
    expect(rows[0].mruCount).toBe(9);
    expect(rows[1].mruCount).toBe(1);
    expect(rows[2].mruCount).toBe(0);
  });

  it('MRU 传入顺序不要求预先排序:模型按次数降序', () => {
    const { rows } = buildList({
      items: ITEMS,
      query: '',
      mru: [
        { id: 'c', count: 1 },
        { id: 'b', count: 7 },
      ],
    });
    expect(ids(rows)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('空查询每行不标命中位置,分数为中性分', () => {
    const { rows } = buildList({ items: ITEMS, query: '' });
    for (const row of rows) {
      expect(row.score).toBe(EMPTY_QUERY_SCORE);
      expect(row.positions).toEqual([]);
      expect(row.ranges).toEqual([]);
    }
  });
});

describe('有查询:按分排序,固定项不插队', () => {
  it('前缀命中排在包含命中之前', () => {
    const { rows, total, truncated } = buildList({ items: ITEMS, query: '项' });
    expect(ids(rows)).toEqual(['c', 'a']);
    expect(rows[0].score).toBeGreaterThanOrEqual(LABEL_PREFIX_BOOST);
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
    expect(total).toBe(2);
    expect(truncated).toBe(false);
  });

  it('固定项不插队:分低就排在后面(仍带 pinned 标记)', () => {
    const { rows } = buildList({ items: ITEMS, query: '项', pinned: ['a'] });
    expect(ids(rows)).toEqual(['c', 'a']);
    expect(rows[1].pinned).toBe(true);
    expect(rows[0].pinned).toBe(false);
  });

  it('固定但未命中的项被过滤掉(有查询时纯按分过滤)', () => {
    const { rows, total } = buildList({ items: ITEMS, query: '项', pinned: ['d'] });
    expect(ids(rows)).toEqual(['c', 'a']);
    expect(total).toBe(2);
  });

  it('无命中返回空列表且 total 为 0', () => {
    const result = buildList({ items: ITEMS, query: '不存在的关键词' });
    expect(result).toEqual({ rows: [], total: 0, truncated: false });
  });

  it('同分保持传入顺序(稳定排序)', () => {
    const same: QuickPickItem[] = [
      { id: 'x1', label: '同名' },
      { id: 'x2', label: '同名' },
    ];
    expect(ids(buildList({ items: same, query: '同名' }).rows)).toEqual(['x1', 'x2']);
  });
});

describe('截断与计数', () => {
  it('截断到 limit,total 是截断前的命中数', () => {
    const { rows, total, truncated } = buildList({ items: ITEMS, query: '', limit: 2 });
    expect(ids(rows)).toEqual(['a', 'b']);
    expect(total).toBe(4);
    expect(truncated).toBe(true);
  });

  it('有查询时同样截断', () => {
    const { rows, total, truncated } = buildList({ items: ITEMS, query: '项', limit: 1 });
    expect(ids(rows)).toEqual(['c']);
    expect(total).toBe(2);
    expect(truncated).toBe(true);
  });

  it('limit <= 0 时只给 truncated 标记', () => {
    const { rows, total, truncated } = buildList({ items: ITEMS, query: '', limit: 0 });
    expect(rows).toEqual([]);
    expect(total).toBe(4);
    expect(truncated).toBe(true);
  });

  it('常量与设计一致:浮层 200 / 输入栏补全 8,limit 缺省用浮层上限', () => {
    expect(QUICK_OPEN_LIMIT).toBe(200);
    expect(COMPLETE_LIMIT).toBe(8);
    const many: QuickPickItem[] = Array.from({ length: 250 }, (_, i) => ({ id: `i${i}`, label: `第 ${i} 条` }));
    const result = buildList({ items: many, query: '' });
    expect(result.rows).toHaveLength(QUICK_OPEN_LIMIT);
    expect(result.total).toBe(250);
    expect(result.truncated).toBe(true);
  });
});

describe('每行带高亮位置(与打分器同源)', () => {
  it('逐字符命中给 positions,相邻合并成 ranges 供 <mark>', () => {
    const { rows } = buildList({ items: ITEMS, query: '项A' });
    expect(rows).toHaveLength(1);
    expect(rows[0].positions).toEqual([3, 5]);
    expect(rows[0].ranges).toEqual([
      { start: 3, end: 4 },
      { start: 5, end: 6 },
    ]);
    const label = rows[0].item.label;
    expect(rows[0].ranges.map((r) => label.slice(r.start, r.end)).join('')).toBe('项A');
  });

  it('provider 预计算分数(分层)优先于模型自打分,score<=0 视为不命中', () => {
    const tiered: QuickPickItem[] = [
      { id: 'title', label: '无关标题', score: PATH_BOOST + 5, positions: [0] },
      { id: 'label', label: '项A 命中' },
      { id: 'empty', label: '项A 也应命中', score: 0, positions: [] },
    ];
    const { rows } = buildList({ items: tiered, query: '项A' });
    expect(ids(rows)).toEqual(['title', 'label']);
    expect(rows[0].ranges).toEqual([{ start: 0, end: 1 }]);
  });
});

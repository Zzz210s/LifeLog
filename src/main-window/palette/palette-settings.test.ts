/**
 * 浮层设置解析/消毒的单测,外加「注入侧真的收掉了 T4 的 N1/N2」的端到端读数:
 * 用真 `buildList` 跑一遍消毒后的注入,断言坏 MRU 不占「最近」档首位、坏 limit 不把列表清空。
 */
import { describe, expect, it } from 'vitest';
import { buildList } from '../../shared/quickpick/model';
import type { QuickPickItem } from '../../shared/quickpick/model';
import {
  PALETTE_LIMIT_DEFAULT,
  PALETTE_SETTING_KEYS,
  parseJsonLoose,
  parsePinnedTags,
  sanitizeLimit,
  sanitizeMruEntries,
} from './palette-settings';

const items: QuickPickItem[] = [
  { id: 'a', label: '甲' },
  { id: 'b', label: '乙' },
  { id: 'c', label: '丙' },
];

describe('palette-settings:键与默认值', () => {
  it('五个键与设计 §5 一致(mruTags 是 T8 补的第五个,设计 §5 表未列)', () => {
    expect(PALETTE_SETTING_KEYS).toEqual({
      mruCommands: 'ui.mru.commands',
      mruNotes: 'ui.mru.notes',
      mruTags: 'ui.mru.tags',
      pinnedTags: 'ui.pinned.tags',
      limit: 'ui.palette.limit',
    });
    expect(PALETTE_LIMIT_DEFAULT).toBe(200);
  });
});

describe('palette-settings:坏数据容错', () => {
  it('坏 JSON / 空串 / 非 JSON 一律当没设置,不抛', () => {
    for (const bad of [null, undefined, '', '  ', '{oops', 'undefined']) {
      expect(parseJsonLoose(bad), String(bad)).toBeNull();
    }
    expect(parseJsonLoose('[{"id":"a","count":2}]')).toEqual([{ id: 'a', count: 2 }]);
  });

  it('MRU 消毒:非有限 / 非正 / 非数字 count 与空 id 全部丢弃(N1)', () => {
    const raw = [
      { id: 'nan', count: Number.NaN },
      { id: 'inf', count: Number.POSITIVE_INFINITY },
      { id: 'neg', count: -1 },
      { id: 'zero', count: 0 },
      { id: 'str', count: '3' },
      { id: '', count: 1 },
      { id: '   ', count: 1 },
      { id: 'ok', count: 2 },
      { id: 'frac', count: 2.7 },
      'not-an-object',
      null,
    ];
    expect(sanitizeMruEntries(raw)).toEqual([
      { id: 'ok', count: 2 },
      { id: 'frac', count: 2 },
    ]);
  });

  it('MRU 消毒:重复 id 取最大次数;非数组一律空表', () => {
    expect(sanitizeMruEntries([{ id: 'a', count: 2 }, { id: 'a', count: 5 }])).toEqual([
      { id: 'a', count: 5 },
    ]);
    for (const bad of [null, undefined, {}, '[]', 3]) {
      expect(sanitizeMruEntries(bad), String(bad)).toEqual([]);
    }
  });

  it('固定标签:数组里只留非空字符串,去重且保持首现顺序', () => {
    expect(parsePinnedTags('["工作","工作","", "生活", 3, null]')).toEqual(['工作', '生活']);
    for (const bad of [null, '{}', '{oops', '"工作"']) {
      expect(parsePinnedTags(bad), String(bad)).toEqual([]);
    }
  });

  it('limit 消毒:非有限 / 0 / 负数 回缺省上限;小数向下取整;字符串数字可用(N2)', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -3, null, undefined, '', 'abc']) {
      expect(sanitizeLimit(bad), String(bad)).toBe(PALETTE_LIMIT_DEFAULT);
    }
    expect(sanitizeLimit('5')).toBe(5);
    expect(sanitizeLimit(7.9)).toBe(7);
    expect(sanitizeLimit(1)).toBe(1);
  });
});

describe('palette-settings:注入侧真的收掉了 N1/N2(真 buildList 读数)', () => {
  it('原始坏 MRU 会抢占首位;消毒后「最近」档只留合法条目', () => {
    const raw = [
      { id: 'c', count: Number.NaN },
      { id: 'b', count: 2 },
    ];
    const dirty = buildList({ items, query: '', mru: raw as never });
    expect(Number.isNaN(dirty.rows[0].mruCount)).toBe(true); // 复现 T4 N1:NaN 抢首位

    const clean = buildList({ items, query: '', mru: sanitizeMruEntries(raw) });
    expect(clean.rows.map((r) => [r.item.id, r.mruCount])).toEqual([
      ['b', 2],
      ['a', 0],
      ['c', 0],
    ]);
  });

  it('原始 -Infinity limit 会回退 200;消毒后按坏设置 = 缺省上限(不是 0 项)', () => {
    const many = Array.from({ length: 250 }, (_, i): QuickPickItem => ({ id: `n${i}`, label: `笔记${i}` }));
    const dirty = buildList({ items: many, query: '', limit: Number.NEGATIVE_INFINITY });
    expect(dirty.rows.length).toBe(200); // 复现 T4 N2:-Infinity 走的是 200 而不是「负数 = 0 行」

    const clean = buildList({ items: many, query: '', limit: sanitizeLimit(Number.NEGATIVE_INFINITY) });
    expect(clean.rows.length).toBe(PALETTE_LIMIT_DEFAULT);
    expect(clean.total).toBe(250);
  });
});

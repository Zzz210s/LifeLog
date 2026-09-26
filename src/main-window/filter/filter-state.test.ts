import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { FILTER_KEY, parseFilterState, serializeFilterState, toggleFilterTag } from './filter-state';

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });

describe('filter-state 默认值与退化(单份条件)', () => {
  it('settings 键与 Rust 侧约定一致', () => {
    expect(FILTER_KEY).toBe('filter_current');
  });

  it('键缺失 / 空串 / 坏 JSON / 非法条件一律退化为空条件', () => {
    const raws = [
      null,
      '',
      '   ',
      '{不是 json',
      '[]',
      '"字符串"',
      'null',
      '{}',
      '{"sort":"sideways"}',
      '{"tags":"x"}',
      '{"keyword":42}',
      '{"tagPresence":"somewhere"}',
    ];
    for (const raw of raws) {
      expect(filterKey(parseFilterState(raw))).toBe(filterKey(EMPTY_FILTER));
    }
  });

  it('合法 JSON 按六字段解析(camelCase),未知字段忽略', () => {
    const raw = JSON.stringify({
      keyword: '电影',
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [],
      tagPresence: 'none',
      sort: 'oldest',
      expr: 'a>1',
      extra: '未知字段',
    });
    expect(parseFilterState(raw)).toEqual(
      cond({ keyword: '电影', tags: [{ path: '工作', includeChildren: true }], tagPresence: 'none', sort: 'oldest', expr: 'a>1' })
    );
  });

  it('序列化只写约定字段,且可原样解析回来(重启恢复的写入形状)', () => {
    const c = cond({
      keyword: '电影',
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [{ path: '私人', includeChildren: false }],
      tagPresence: 'any',
      sort: 'oldest',
      expr: 'a>1',
    });
    const raw = serializeFilterState(c);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual([
      'excludeTags',
      'expr',
      'keyword',
      'sort',
      'tagPresence',
      'tags',
    ]);
    expect(JSON.parse(raw)).toEqual(c);
    expect(parseFilterState(raw)).toEqual(c);
    // 往返幂等:再序列化一次字节一致
    expect(serializeFilterState(parseFilterState(raw))).toBe(raw);
    expect(serializeFilterState(EMPTY_FILTER)).toBe(JSON.stringify(EMPTY_FILTER));
  });
});

describe('filter-state toggleFilterTag(与侧栏点标签同口径)', () => {
  it('未选中则加入(默认含子级),已选中则移除', () => {
    const on = toggleFilterTag(EMPTY_FILTER, '健康');
    expect(on.tags).toEqual([{ path: '健康', includeChildren: true }]);
    expect(toggleFilterTag(on, '健康').tags).toEqual([]);
  });

  it('排除侧命中就移到包含侧', () => {
    const c = cond({ excludeTags: [{ path: '健康', includeChildren: false }] });
    const moved = toggleFilterTag(c, '健康');
    expect(moved.tags).toEqual([{ path: '健康', includeChildren: true }]);
    expect(moved.excludeTags).toEqual([]);
  });

  it('遗留数据里两侧同路径时不造出重复的 tags 项', () => {
    const c = cond({
      tags: [{ path: '健康', includeChildren: false }],
      excludeTags: [{ path: '健康', includeChildren: false }],
    });
    const moved = toggleFilterTag(c, '健康');
    expect(moved.tags).toEqual([{ path: '健康', includeChildren: false }]);
    expect(moved.excludeTags).toEqual([]);
  });

  it('只动标签字段,其它条件原样保留', () => {
    const c = cond({ keyword: '电影', sort: 'oldest', expr: 'a>1' });
    const on = toggleFilterTag(c, '健康');
    expect(on.keyword).toBe('电影');
    expect(on.sort).toBe('oldest');
    expect(on.expr).toBe('a>1');
  });

  it('退化时返回的是副本,不是共享的 EMPTY_FILTER 常量(别名风险)', () => {
    const a = parseFilterState(null);
    const b = parseFilterState('坏 JSON');
    expect(a).not.toBe(EMPTY_FILTER);
    expect(b).not.toBe(EMPTY_FILTER);
    expect(a).not.toBe(b);
    expect(a).toEqual(EMPTY_FILTER);
  });

  it('Rust 写出的形状(含 sort:null)必须被接受,非空条件不被吞成空条件', () => {
    // 真源:Rust `FilterConditions` 的 Serialize —— 未设 sort 时**会写出 null**;
    // 这条串就是迁移 016 落库的形状(真机备份里逐字节同形)。
    const fromRust = JSON.stringify({
      keyword: '电影',
      tags: [{ path: '书籍/小说', includeChildren: true }],
      excludeTags: [],
      tagPresence: null,
      sort: null,
      expr: null,
    });
    const c = parseFilterState(fromRust);
    expect(c.keyword).toBe('电影');
    expect(c.tags).toEqual([{ path: '书籍/小说', includeChildren: true }]);
    expect(c.sort).toBe('newest'); // null 归一成默认,不是整串退化
    expect(filterKey(c)).toBe(filterKey({ ...EMPTY_FILTER, keyword: '电影', tags: [{ path: '书籍/小说', includeChildren: true }] }));
  });
});

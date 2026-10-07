import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, allItems, normalizeGroups } from './filter-conditions';
import { canEvaluateLocally, matchesTagsByPath } from './filter-conditions-local';
import { normalizeFilter } from './filter-conditions-normalize';
import { parseFilterJson } from './filter-conditions-parse';
import type { FilterConditions, SortCond, TagCond } from './filter-conditions';

const tag = (path: string, includeChildren = false): TagCond => ({ path, includeChildren });
const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });
const timeSort = (dir: 'asc' | 'desc' = 'asc'): SortCond => ({ kind: 'time', dir, enabled: true });

describe('parseFilterJson', () => {
  it('空串、null、坏 JSON 一律回退默认', () => {
    expect(parseFilterJson(null)).toBe(EMPTY_FILTER);
    expect(parseFilterJson('')).toBe(EMPTY_FILTER);
    expect(parseFilterJson('   ')).toBe(EMPTY_FILTER);
    expect(parseFilterJson('{不是 json')).toBe(EMPTY_FILTER);
    expect(parseFilterJson('"字符串"')).toBe(EMPTY_FILTER);
    expect(parseFilterJson('[1,2]')).toBe(EMPTY_FILTER);
  });

  it('字段类型非法或校验不通过回退默认', () => {
    expect(parseFilterJson(JSON.stringify({ tags: 'x' }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ tags: [{ path: 1 }] }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ tagPresence: 'some' }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ sort: 'sideways' }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ keyword: 'x'.repeat(201) }))).toBe(EMPTY_FILTER);
  });

  it('已取消的日期字段(from/to)静默丢弃,其余字段照常读回', () => {
    const raw = JSON.stringify({
      keyword: '电影',
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [{ path: '临时', includeChildren: false }],
      from: '2026-08-01',
      to: '2026-09-13',
      tagPresence: 'any',
      sort: 'oldest',
      expr: '#工作 AND NOT #临时',
      unknownField: 42,
    });
    // 归一后平铺字段搬进 groups[0](顺序 = 旧 where_clause 口径),from/to 与未知字段不进结果
    const parsed = parseFilterJson(raw);
    expect(allItems(parsed)).toEqual([
      { kind: 'keyword', value: '电影' },
      { kind: 'tag', path: '工作', includeChildren: true },
      { kind: 'excludeTag', path: '临时', includeChildren: false },
      { kind: 'presence', value: 'any' },
      { kind: 'expr', value: '#工作 AND NOT #临时' },
    ]);
    expect(parsed.sort).toBe('oldest');
    expect(parsed.sorts).toEqual([{ kind: 'time', dir: 'asc', enabled: true }]);
    // 只有旧日期键也不回退默认:归一后就是空条件(合法;迁移 014 起 filter_last 键也已删除)
    expect(parseFilterJson(JSON.stringify({ from: '2026-08-01', to: '2026-09-13' }))).toEqual(EMPTY_FILTER);
  });

  it('表达式:缺字段/空白回退 null,非字符串或超长回退默认条件', () => {
    expect(parseFilterJson(JSON.stringify({ expr: '  ' }))).toEqual(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ expr: 42 }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ expr: 'x'.repeat(501) }))).toBe(EMPTY_FILTER);
  });

  it('缺字段走各自默认,空白关键词归一为 null', () => {
    expect(parseFilterJson(JSON.stringify({ keyword: '  ' }))).toEqual(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ sort: 'oldest' }))).toEqual(
      cond({ sort: 'oldest', sorts: [timeSort('asc')] })
    );
    expect(parseFilterJson(JSON.stringify({ sorts: [{ kind: 'time', dir: 'desc' }] }))).toEqual(
      cond({ sorts: [{ kind: 'time', dir: 'desc', enabled: true }] })
    );
    // 显式 sorts 优先于旧 sort;非数组 sorts 由旧 sort 合成(存量条件不被抹掉)
    expect(
      parseFilterJson(JSON.stringify({ sort: 'oldest', sorts: [{ kind: 'tag', path: '地点', dir: 'desc', enabled: false }] }))
    ).toEqual(cond({ sort: 'oldest', sorts: [{ kind: 'tag', path: '地点', dir: 'desc', enabled: false }] }));
    expect(parseFilterJson(JSON.stringify({ sort: 'oldest', sorts: '坏值' }))).toEqual(
      cond({ sort: 'oldest', sorts: [timeSort('asc')] })
    );
    expect(parseFilterJson(JSON.stringify({ sorts: [] }))).toEqual(EMPTY_FILTER);
    expect(allItems(parseFilterJson(JSON.stringify({ tags: [{ path: '工作' }] })))).toEqual([
      { kind: 'tag', path: '工作', includeChildren: false },
    ]);
  });
});

describe('本地重判(就地更新用)', () => {
  it('仅本级且无排除/有无标签/表达式时可本地判定', () => {
    expect(canEvaluateLocally(EMPTY_FILTER)).toBe(true);
    expect(canEvaluateLocally(cond({ tags: [tag('a')] }))).toBe(true);
    // 2026-10-06 条件组口径收紧:组内项必须全是「仅本级引入标签」;
    // 同组出现关键词项(或任何非标签项)一律重查后端(安全方向的收紧,非错判)
    expect(canEvaluateLocally(cond({ tags: [tag('a')], keyword: 'x' }))).toBe(false);
    expect(canEvaluateLocally(cond({ tags: [tag('a', true)] }))).toBe(false);
    expect(canEvaluateLocally(cond({ excludeTags: [tag('x')] }))).toBe(false);
    expect(canEvaluateLocally(cond({ tagPresence: 'any' }))).toBe(false);
    expect(canEvaluateLocally(cond({ tagPresence: 'none' }))).toBe(false);
    expect(canEvaluateLocally(cond({ expr: '#工作' }))).toBe(false);
  });

  it('同路径集合重判(AND)', () => {
    const note = { tags: ['a', 'b/c'] };
    expect(matchesTagsByPath(note, EMPTY_FILTER)).toBe(true);
    expect(matchesTagsByPath(note, cond({ tags: [tag('a'), tag('b/c')] }))).toBe(true);
    expect(matchesTagsByPath(note, cond({ tags: [tag('a'), tag('缺')] }))).toBe(false);
  });
});

describe('normalizeFilter(应用保存视图时归一)', () => {
  it('缺字段/null sort/undefined 回退默认,防半成品对象进状态机', () => {
    expect(normalizeFilter(undefined)).toEqual(EMPTY_FILTER);
    expect(normalizeFilter(null)).toEqual(EMPTY_FILTER);
    expect(normalizeFilter({})).toEqual(EMPTY_FILTER);
    expect(normalizeFilter({ keyword: '电影', sort: null as unknown as undefined })).toEqual(
      normalizeGroups(cond({ keyword: '电影' }))
    );
  });

  it('合法字段原样保留,非法 sort/tagPresence 按默认处理', () => {
    const c = cond({
      tags: [tag('工作', true)],
      tagPresence: 'any',
      sort: 'oldest',
      sorts: [timeSort('asc')],
    });
    expect(normalizeFilter(c)).toEqual(normalizeGroups(c));
    expect(
      normalizeFilter({ ...c, sort: 'sideways' as unknown as FilterConditions['sort'] })
    ).toEqual(
      normalizeGroups(
        cond({ tags: [tag('工作', true)], tagPresence: 'any', sorts: [timeSort('asc')] })
      )
    );
    expect(
      normalizeFilter({ tagPresence: 'some' as unknown as FilterConditions['tagPresence'] })
    ).toEqual(EMPTY_FILTER);
  });

  it('旧日期字段不进入归一结果(保存视图里的残留不会被带回状态机)', () => {
    const legacy = { ...EMPTY_FILTER, from: '2026-08-01', to: '2026-09-13' } as unknown as FilterConditions;
    expect(normalizeFilter(legacy)).toEqual(EMPTY_FILTER);
  });
});

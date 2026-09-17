import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from './filter-conditions';
import { canEvaluateLocally, matchesTagsByPath } from './filter-conditions-local';
import { hasLegacyDateKeys, normalizeFilter, parseFilterJson } from './filter-conditions-parse';
import type { FilterConditions, TagCond } from './filter-conditions';

const tag = (path: string, includeChildren = false): TagCond => ({ path, includeChildren });
const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });

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
    expect(parseFilterJson(raw)).toEqual({
      keyword: '电影',
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [{ path: '临时', includeChildren: false }],
      tagPresence: 'any',
      sort: 'oldest',
      expr: '#工作 AND NOT #临时',
    });
    // 只有旧日期键也不回退默认:归一后就是空条件(合法)
    expect(parseFilterJson(JSON.stringify({ from: '2026-08-01', to: '2026-09-13' }))).toEqual(EMPTY_FILTER);
  });

  it('表达式:缺字段/空白回退 null,非字符串或超长回退默认条件', () => {
    expect(parseFilterJson(JSON.stringify({ expr: '  ' }))).toEqual(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ expr: 42 }))).toBe(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ expr: 'x'.repeat(501) }))).toBe(EMPTY_FILTER);
  });

  it('缺字段走各自默认,空白关键词归一为 null', () => {
    expect(parseFilterJson(JSON.stringify({ keyword: '  ' }))).toEqual(EMPTY_FILTER);
    expect(parseFilterJson(JSON.stringify({ sort: 'oldest' }))).toEqual(cond({ sort: 'oldest' }));
    expect(parseFilterJson(JSON.stringify({ tags: [{ path: '工作' }] }))).toEqual(
      cond({ tags: [tag('工作')] })
    );
  });
});

describe('hasLegacyDateKeys(旧 filter_last 归一信号)', () => {
  it('带 from/to 的合法 JSON 才算残留', () => {
    expect(hasLegacyDateKeys(JSON.stringify({ from: '2026-08-01' }))).toBe(true);
    expect(hasLegacyDateKeys(JSON.stringify({ to: null }))).toBe(true);
    expect(hasLegacyDateKeys(JSON.stringify({ from: null, to: null, keyword: '电影' }))).toBe(true);
  });

  it('无旧键、空串、坏 JSON、非对象一律不算', () => {
    expect(hasLegacyDateKeys(JSON.stringify({ keyword: '电影' }))).toBe(false);
    expect(hasLegacyDateKeys(null)).toBe(false);
    expect(hasLegacyDateKeys('   ')).toBe(false);
    expect(hasLegacyDateKeys('{不是 json')).toBe(false);
    expect(hasLegacyDateKeys('[1,2]')).toBe(false);
  });
});

describe('本地重判(就地更新用)', () => {
  it('仅本级且无排除/有无标签/表达式时可本地判定', () => {
    expect(canEvaluateLocally(EMPTY_FILTER)).toBe(true);
    expect(canEvaluateLocally(cond({ tags: [tag('a')], keyword: 'x' }))).toBe(true);
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
      cond({ keyword: '电影' })
    );
  });

  it('合法字段原样保留,非法 sort/tagPresence 按默认处理', () => {
    const c = cond({ tags: [tag('工作', true)], tagPresence: 'any', sort: 'oldest' });
    expect(normalizeFilter(c)).toEqual(c);
    expect(
      normalizeFilter({ ...c, sort: 'sideways' as unknown as FilterConditions['sort'] })
    ).toEqual(cond({ tags: [tag('工作', true)], tagPresence: 'any' }));
    expect(
      normalizeFilter({ tagPresence: 'some' as unknown as FilterConditions['tagPresence'] })
    ).toEqual(EMPTY_FILTER);
  });

  it('旧日期字段不进入归一结果(保存视图里的残留不会被带回状态机)', () => {
    const legacy = { ...EMPTY_FILTER, from: '2026-08-01', to: '2026-09-13' } as unknown as FilterConditions;
    expect(normalizeFilter(legacy)).toEqual(EMPTY_FILTER);
  });
});

import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from '../shared/filter-conditions';
import { applyTagPick, chipsOf, summaryOf } from './filter-chips';

const c = { ...EMPTY_FILTER, keyword: '电影', tags: [{ path: '工作', includeChildren: true }], tagPresence: 'none' as const, sort: 'oldest' as const };

describe('chipsOf', () => {
  it('每个收窄来源一个 chip,标签带含子级标记', () => {
    const labels = chipsOf(c).map((x) => x.label);
    expect(labels).toEqual(['关键词:电影', '#工作(含子级)', '无标签', '最早在前']);
  });
  it('删除某 chip 后条件对象不含该项', () => {
    const keywordChip = chipsOf(c).find((x) => x.kind === 'keyword')!;
    expect(keywordChip.remove.keyword).toBeNull();
    expect(keywordChip.remove.tags).toHaveLength(1);
  });
  it('空条件没有 chip', () => { expect(chipsOf(EMPTY_FILTER)).toEqual([]); });
});

describe('summaryOf', () => {
  it('中文一句话', () => { expect(summaryOf(c)).toBe('关键词「电影」;标签 工作(含子级);无标签;最早在前'); });
  it('空条件为空串', () => { expect(summaryOf(EMPTY_FILTER)).toBe(''); });
});

describe('chipsOf 补充', () => {
  it('排除/日期/有标签各一个 chip,删除后对应字段清空', () => {
    const cc = {
      ...EMPTY_FILTER,
      excludeTags: [{ path: '临时', includeChildren: false }],
      from: '2026-08-01',
      to: '2026-09-13',
      tagPresence: 'any' as const,
    };
    const chips = chipsOf(cc);
    expect(chips.map((x) => x.label)).toEqual(['排除 #临时', '08-01 至 09-13', '有标签']);
    expect(chips.find((x) => x.kind === 'excludeTag')!.remove.excludeTags).toEqual([]);
    const date = chips.find((x) => x.kind === 'date')!;
    expect(date.remove.from).toBeNull();
    expect(date.remove.to).toBeNull();
    expect(chips.find((x) => x.kind === 'presence')!.remove.tagPresence).toBeNull();
  });
  it('日期只填一端的两种文案', () => {
    expect(chipsOf({ ...EMPTY_FILTER, from: '2026-08-01' }).map((x) => x.label)).toEqual(['08-01 起']);
    expect(chipsOf({ ...EMPTY_FILTER, to: '2026-09-13' }).map((x) => x.label)).toEqual(['截至 09-13']);
  });
  it('排序非默认才出 chip;关键词空白不出 chip', () => {
    expect(chipsOf({ ...EMPTY_FILTER, keyword: '   ' })).toEqual([]);
    expect(chipsOf({ ...EMPTY_FILTER, sort: 'oldest' as const }).map((x) => x.label)).toEqual(['最早在前']);
  });
});

describe('summaryOf 补充', () => {
  it('排除/日期/多标签都进摘要', () => {
    const cc = {
      ...EMPTY_FILTER,
      tags: [{ path: '工作', includeChildren: true }, { path: '生活/健身', includeChildren: false }],
      excludeTags: [{ path: '临时', includeChildren: false }],
      from: '2026-08-01',
    };
    expect(summaryOf(cc)).toBe('标签 工作(含子级)、生活/健身;排除 临时;日期 08-01 起');
  });
  it('仅有排序也入摘要(与 isFilterEmpty 的收窄口径解耦)', () => {
    expect(summaryOf({ ...EMPTY_FILTER, sort: 'oldest' as const })).toBe('最早在前');
  });
});

describe('applyTagPick 补充', () => {
  it('已存在同路径(含子级开关不同)不重复也不改写', () => {
    const once = applyTagPick(EMPTY_FILTER, '工作', { exclude: false, includeChildren: true });
    const twice = applyTagPick(once, '工作', { exclude: false, includeChildren: false });
    expect(twice.tags).toHaveLength(1);
    expect(twice.tags[0]).toEqual({ path: '工作', includeChildren: true });
  });
  it('排除侧同样不重复;引入与排除互不影响', () => {
    const a = applyTagPick(EMPTY_FILTER, '临时', { exclude: true, includeChildren: false });
    const b = applyTagPick(a, '临时', { exclude: true, includeChildren: true });
    expect(b.excludeTags).toHaveLength(1);
    const c2 = applyTagPick(b, '工作', { exclude: false, includeChildren: true });
    expect(c2.excludeTags).toHaveLength(1);
    expect(c2.tags).toHaveLength(1);
  });
});

describe('applyTagPick', () => {
  it('不重复添加同一路径', () => {
    const once = applyTagPick(EMPTY_FILTER, '工作', { exclude: false, includeChildren: true });
    const twice = applyTagPick(once, '工作', { exclude: false, includeChildren: true });
    expect(twice.tags).toHaveLength(1);
  });
  it('排除项进入 excludeTags', () => {
    const r = applyTagPick(EMPTY_FILTER, '临时', { exclude: true, includeChildren: true });
    expect(r.excludeTags[0]).toEqual({ path: '临时', includeChildren: true });
  });
});

import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import { EXPR_TEXT_MAX, applyTagPick, chipsOf, summaryOf, summaryTitleOf, truncateExpr } from './filter-chips';

const EXPR = '#工作 AND NOT #临时';

describe('表达式 chip 与摘要', () => {
  it('表达式作为一项 chip,可单独删除', () => {
    const chips = chipsOf({ ...EMPTY_FILTER, expr: EXPR });
    const chip = chips.find((c) => c.kind === 'expr')!;
    expect(chip.label).toContain('表达式');
    expect(chip.label).toBe(`表达式:${EXPR}`);
    expect(chip.remove.expr).toBeNull();
    expect(chip.remove.keyword).toBeNull();
  });

  it('摘要里带截断的表达式原文', () => {
    expect(summaryOf({ ...EMPTY_FILTER, expr: '#工作' })).toContain('表达式:#工作');
  });

  it('表达式过长时 chip 与摘要截断,chip title 与摘要 title 保留全文', () => {
    const long = '#工作' + ' 或 '.repeat(20) + '#生活';
    const chips = chipsOf({ ...EMPTY_FILTER, expr: long });
    const chip = chips.find((c) => c.kind === 'expr')!;
    expect(chip.label).toBe(`表达式:${truncateExpr(long)}`);
    expect(chip.label).toContain('…');
    expect(chip.title).toBe(`表达式:${long}`);
    expect(summaryTitleOf({ ...EMPTY_FILTER, expr: long })).toContain(long);
    expect(summaryOf({ ...EMPTY_FILTER, expr: long })).toContain('…');
  });

  it('全空白表达式不出 chip 也不进摘要', () => {
    expect(chipsOf({ ...EMPTY_FILTER, expr: '   ' })).toEqual([]);
    expect(summaryOf({ ...EMPTY_FILTER, expr: '  ' })).toBe('');
  });

  it('截断按码点计数,不把代理对劈开', () => {
    const text = '\u{1F600}'.repeat(EXPR_TEXT_MAX + 5);
    expect([...truncateExpr(text)].length).toBe(EXPR_TEXT_MAX + 1); // 含省略号
    expect(truncateExpr(text)).not.toContain('\uFFFD');
  });
});

const c = { ...EMPTY_FILTER, keyword: '电影', tags: [{ path: '工作', includeChildren: true }], tagPresence: 'none' as const, sort: 'oldest' as const };

describe('chipsOf', () => {
  it('每个收窄来源一个 chip,标签只显路径、含子级用标记与 title 表达', () => {
    const chips = chipsOf(c);
    expect(chips.map((x) => x.label)).toEqual(['关键词:电影', '⊢ #工作', '无标签', '最早在前']);
    expect(chips.find((x) => x.kind === 'tag')!.title).toBe('含子级');
    expect(chips.find((x) => x.kind === 'tag')!.label).not.toContain('含子级');
  });
  it('仅本级标签无前缀标记,title 为仅本级', () => {
    const only = chipsOf({ ...EMPTY_FILTER, tags: [{ path: '工作', includeChildren: false }] });
    expect(only[0].label).toBe('#工作');
    expect(only[0].title).toBe('仅本级');
  });
  it('删除某 chip 后条件对象不含该项', () => {
    const keywordChip = chipsOf(c).find((x) => x.kind === 'keyword')!;
    expect(keywordChip.remove.keyword).toBeNull();
    expect(keywordChip.remove.tags).toHaveLength(1);
  });
  it('空条件没有 chip', () => { expect(chipsOf(EMPTY_FILTER)).toEqual([]); });
});

describe('summaryOf', () => {
  it('中文一句话', () => { expect(summaryOf(c)).toBe('关键词「电影」;标签 工作;无标签;最早在前'); });
  it('空条件为空串', () => { expect(summaryOf(EMPTY_FILTER)).toBe(''); });
  it('摘要不出现含子级注释', () => { expect(summaryOf(c)).not.toContain('含子级'); });
});

describe('chipsOf 补充', () => {
  it('排除/有标签各一个 chip,删除后对应字段清空', () => {
    const cc = {
      ...EMPTY_FILTER,
      excludeTags: [{ path: '临时', includeChildren: false }],
      tagPresence: 'any' as const,
    };
    const chips = chipsOf(cc);
    expect(chips.map((x) => x.label)).toEqual(['排除 #临时', '有标签']);
    expect(chips.find((x) => x.kind === 'excludeTag')!.title).toBe('仅本级');
    expect(chips.find((x) => x.kind === 'excludeTag')!.remove.excludeTags).toEqual([]);
    expect(chips.find((x) => x.kind === 'presence')!.remove.tagPresence).toBeNull();
  });
  it('日期已取消:条件对象无日期字段,自然无日期 chip', () => {
    expect(chipsOf(EMPTY_FILTER).some((x) => (x.kind as string) === 'date')).toBe(false);
    expect(Object.keys(EMPTY_FILTER)).not.toContain('from');
    expect(Object.keys(EMPTY_FILTER)).not.toContain('to');
  });
  it('排序非默认才出 chip;关键词空白不出 chip', () => {
    expect(chipsOf({ ...EMPTY_FILTER, keyword: '   ' })).toEqual([]);
    expect(chipsOf({ ...EMPTY_FILTER, sort: 'oldest' as const }).map((x) => x.label)).toEqual(['最早在前']);
  });
});

describe('summaryOf 补充', () => {
  it('排除/多标签都进摘要', () => {
    const cc = {
      ...EMPTY_FILTER,
      tags: [{ path: '工作', includeChildren: true }, { path: '生活/健身', includeChildren: false }],
      excludeTags: [{ path: '临时', includeChildren: false }],
    };
    expect(summaryOf(cc)).toBe('标签 工作、生活/健身;排除 临时');
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

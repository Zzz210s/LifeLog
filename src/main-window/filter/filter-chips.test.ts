import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, allItems, itemPaths } from '../../shared/filter-conditions';
import { EXPR_TEXT_MAX, applyTagPick, chipsOf, summaryOf, summarySegmentsOf, summaryTitleOf, truncateExpr } from './filter-chips';

const EXPR = '#工作 AND NOT #临时';

describe('表达式 chip 与摘要', () => {
  it('表达式作为一项 chip,可单独删除', () => {
    const chips = chipsOf({ ...EMPTY_FILTER, expr: EXPR });
    const chip = chips.find((c) => c.kind === 'expr')!;
    expect(chip.label).toContain('表达式');
    expect(chip.label).toBe(`表达式:${EXPR}`);
    // 删掉表达式这一项后条件为空(旧平铺字段断言在新模型下已恒真,换成组内项)
    expect(allItems(chip.remove)).toEqual([]);
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
    // 摘要 title 不截断,但表达式里的标签叶子会带上 +携带(与摘要正文同口径)
    expect(summaryTitleOf({ ...EMPTY_FILTER, expr: long })).toBe(
      `表达式:#工作+携带${' 或 '.repeat(20)}#生活+携带`
    );
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

const ASC = [{ kind: 'time', dir: 'asc', enabled: true }] as const;
const c = { ...EMPTY_FILTER, keyword: '电影', tags: [{ path: '工作', includeChildren: true }], tagPresence: 'none' as const, sort: 'oldest' as const, sorts: [...ASC] };

describe('chipsOf', () => {
  it('每个收窄来源一个 chip,标签只显路径、含子级用标记与 title 表达', () => {
    const chips = chipsOf(c);
    expect(chips.map((x) => x.label)).toEqual(['关键词:电影', '⊢ #工作', '无标签', '排序: 旧 -> 新']);
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
    expect(allItems(keywordChip.remove).some((it) => it.kind === 'keyword')).toBe(false);
    expect(itemPaths(keywordChip.remove, 'tag')).toHaveLength(1);
  });
  it('空条件没有 chip', () => { expect(chipsOf(EMPTY_FILTER)).toEqual([]); });
});

describe('summaryOf', () => {
  it('中文一句话', () => { expect(summaryOf(c)).toBe('关键词「电影」;标签 工作+携带;无标签;1 条排序'); });
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
    const exclRemove = chips.find((x) => x.kind === 'excludeTag')!.remove;
    expect(itemPaths(exclRemove, 'excludeTag')).toEqual([]);
    expect(allItems(exclRemove)).toContainEqual({ kind: 'presence', value: 'any' });
    const presRemove = chips.find((x) => x.kind === 'presence')!.remove;
    expect(allItems(presRemove).some((it) => it.kind === 'presence')).toBe(false);
    expect(itemPaths(presRemove, 'excludeTag')).toEqual(['临时']);
  });
  it('日期已取消:条件对象无日期字段,自然无日期 chip', () => {
    expect(chipsOf(EMPTY_FILTER).some((x) => (x.kind as string) === 'date')).toBe(false);
    expect(Object.keys(EMPTY_FILTER)).not.toContain('from');
    expect(Object.keys(EMPTY_FILTER)).not.toContain('to');
  });
  it('排序 chip:每条启用的排序一个,文案随维度变', () => {
    expect(chipsOf({ ...EMPTY_FILTER, keyword: '   ' })).toEqual([]);
    const sorts = [
      { kind: 'tag' as const, path: '地点', dir: 'asc' as const, enabled: true },
      { kind: 'time' as const, dir: 'asc' as const, enabled: true },
    ];
    expect(chipsOf({ ...EMPTY_FILTER, sorts }).map((x) => x.label)).toEqual([
      '排序: 地点 选项顺序',
      '排序: 旧 -> 新',
    ]);
  });

  it('停用的排序不出 chip;单删只移除该项', () => {
    const sorts = [
      { kind: 'time' as const, dir: 'desc' as const, enabled: false },
      { kind: 'tag' as const, path: '地点', dir: 'asc' as const, enabled: true },
    ];
    const chips = chipsOf({ ...EMPTY_FILTER, sorts });
    expect(chips.map((x) => x.label)).toEqual(['排序: 地点 选项顺序']);
    expect(chips[0].remove.sorts).toEqual([sorts[0]]);
  });

  it('空数组(默认时间降序)不出 chip', () => {
    expect(chipsOf(EMPTY_FILTER)).toEqual([]);
  });
});

describe('summaryOf 补充', () => {
  it('排除/多标签都进摘要', () => {
    const cc = {
      ...EMPTY_FILTER,
      tags: [{ path: '工作', includeChildren: true }, { path: '生活/健身', includeChildren: false }],
      excludeTags: [{ path: '临时', includeChildren: false }],
    };
    expect(summaryOf(cc)).toBe('标签 工作+携带、生活/健身+携带;排除 临时+携带');
  });
  it('仅有排序也入摘要:N 条排序(与 isFilterEmpty 的收窄口径解耦)', () => {
    expect(summaryOf({ ...EMPTY_FILTER, sorts: [...ASC] })).toBe('1 条排序');
    expect(
      summaryOf({
        ...EMPTY_FILTER,
        sorts: [...ASC, { kind: 'tag', path: '地点', dir: 'asc', enabled: true }],
      })
    ).toBe('2 条排序');
  });

  it('排序全停用不进摘要', () => {
    expect(summaryOf({ ...EMPTY_FILTER, sorts: [{ kind: 'time', dir: 'asc', enabled: false }] })).toBe('');
  });
});

describe('applyTagPick 补充', () => {
  it('已存在同路径(含子级开关不同)不重复也不改写', () => {
    const once = applyTagPick(EMPTY_FILTER, '工作', { exclude: false, includeChildren: true });
    const twice = applyTagPick(once, '工作', { exclude: false, includeChildren: false });
    expect(itemPaths(twice, 'tag')).toHaveLength(1);
    expect(allItems(twice)).toEqual([{ kind: 'tag', path: '工作', includeChildren: true }]);
  });
  it('排除侧同样不重复;引入与排除互不影响', () => {
    const a = applyTagPick(EMPTY_FILTER, '临时', { exclude: true, includeChildren: false });
    const b = applyTagPick(a, '临时', { exclude: true, includeChildren: true });
    expect(itemPaths(b, 'excludeTag')).toHaveLength(1);
    const c2 = applyTagPick(b, '工作', { exclude: false, includeChildren: true });
    expect(itemPaths(c2, 'excludeTag')).toHaveLength(1);
    expect(itemPaths(c2, 'tag')).toHaveLength(1);
  });
});

describe('携带标记 +携带', () => {
  it('引入与排除的每个标签条件后都跟 +携带', () => {
    const cc = {
      ...EMPTY_FILTER,
      tags: [{ path: '地点/国籍/日本', includeChildren: true }],
      excludeTags: [{ path: '临时', includeChildren: false }],
    };
    expect(summaryOf(cc)).toBe('标签 地点/国籍/日本+携带;排除 临时+携带');
  });

  it('+携带 是独立片段(carry=true),供渲染成小字', () => {
    const segs = summarySegmentsOf({
      ...EMPTY_FILTER,
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [{ path: '临时', includeChildren: false }],
    });
    expect(segs.filter((s) => s.carry).map((s) => s.text)).toEqual(['+携带', '+携带']);
    expect(segs.map((s) => s.text).join('')).toBe(summaryOf({
      ...EMPTY_FILTER,
      tags: [{ path: '工作', includeChildren: true }],
      excludeTags: [{ path: '临时', includeChildren: false }],
    }));
  });

  it('无标签条件时摘要里没有 +携带', () => {
    expect(summaryOf({ ...EMPTY_FILTER, keyword: '电影' })).not.toContain('+携带');
  });
});

describe('applyTagPick', () => {
  it('不重复添加同一路径', () => {
    const once = applyTagPick(EMPTY_FILTER, '工作', { exclude: false, includeChildren: true });
    const twice = applyTagPick(once, '工作', { exclude: false, includeChildren: true });
    expect(itemPaths(twice, 'tag')).toHaveLength(1);
  });
  it('排除项进入 excludeTags', () => {
    const r = applyTagPick(EMPTY_FILTER, '临时', { exclude: true, includeChildren: true });
    expect(allItems(r)).toEqual([{ kind: 'excludeTag', path: '临时', includeChildren: true }]);
  });
});
